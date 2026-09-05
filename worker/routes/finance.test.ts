/**
 * The finance routes: ledger CRUD, visibility, receipts (including PDF), the
 * part-order status ladder and the approver flag.
 *
 * The visibility tests pin a product decision rather than a default: every
 * role INCLUDING viewers reads the ledger, and only coach/mentor writes it.
 * If either direction regresses, the failure should name the decision.
 */
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { call, callJson, inviteAndAccept, signUpCoach, stubResend, whoami } from './_helpers';
import { currentSeason } from './auth';

beforeAll(() => {
  stubResend();
});

// ------------------------------------------------------------------ fixtures

function join(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const ascii = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0)));
const be32 = (n: number) =>
  new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  return join(be32(data.length), ascii(type), data, be32(0));
}

/** A structurally valid PNG, same shape as media.test.ts builds. */
function png(width: number, height: number): Uint8Array {
  return join(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', join(be32(width), be32(height), new Uint8Array([8, 6, 0, 0, 0]))),
    pngChunk('IDAT', new Uint8Array([0x78, 0x9c, 0x00])),
    pngChunk('IEND', new Uint8Array(0)),
  );
}

/** Enough of a PDF for the sniffer, which reads only the 5-byte signature. */
function pdf(): Uint8Array {
  return ascii('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
}

interface Transaction {
  id: string;
  kind: string;
  category: string;
  label: string;
  amount_cents: number;
  receipts?: { id: string; is_pdf: number }[];
  order_item?: string | null;
}

interface Order {
  id: string;
  status: string;
  transaction_id: string | null;
  decision_note: string | null;
  qty: number;
  unit_price_cents: number;
}

async function createTransaction(
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: { transaction: Transaction; error?: string } }> {
  return callJson('/api/finance/transactions', {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      kind: 'expense',
      category: 'parts',
      label: 'REV kit restock',
      amount_cents: 31240,
      occurred_at: 1_760_000_000,
      ...overrides,
    }),
  });
}

async function createOrder(
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: { order: Order; error?: string } }> {
  return callJson('/api/finance/orders', {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      item: 'goBILDA 5203 servo',
      qty: 2,
      unit_price_cents: 3999,
      vendor: 'goBILDA',
      url: 'https://www.gobilda.com/5203-series',
      ...overrides,
    }),
  });
}

async function uploadReceipt(
  cookie: string,
  transactionId: string,
  bytes: Uint8Array,
  contentType = 'application/octet-stream',
): Promise<Response> {
  return call(`/api/finance/transactions/${transactionId}/receipts`, {
    method: 'POST',
    cookie,
    headers: { 'Content-Type': contentType },
    body: bytes as unknown as BodyInit,
  });
}

// -------------------------------------------------------------------- ledger

describe('ledger', () => {
  it('creates, lists, edits and deletes a transaction', async () => {
    const cookie = await signUpCoach(5100);

    const income = await createTransaction(cookie, {
      kind: 'income',
      category: 'sponsorship',
      label: 'Acme Tool sponsorship',
      amount_cents: 50000,
    });
    expect(income.status).toBe(201);
    const expense = await createTransaction(cookie);
    expect(expense.status).toBe(201);

    const list = await callJson<{ transactions: Transaction[] }>(
      '/api/finance/transactions',
      { cookie },
    );
    expect(list.status).toBe(200);
    expect(list.body.transactions).toHaveLength(2);

    const patched = await callJson<{ transaction: Transaction }>(
      `/api/finance/transactions/${expense.body.transaction.id}`,
      { method: 'PATCH', cookie, body: JSON.stringify({ amount_cents: 32900 }) },
    );
    expect(patched.status).toBe(200);
    expect(patched.body.transaction.amount_cents).toBe(32900);

    const deleted = await callJson(
      `/api/finance/transactions/${expense.body.transaction.id}`,
      { method: 'DELETE', cookie },
    );
    expect(deleted.status).toBe(200);

    const after = await callJson<{ transactions: Transaction[] }>(
      '/api/finance/transactions',
      { cookie },
    );
    expect(after.body.transactions).toHaveLength(1);
  });

  it('rejects an empty patch and 404s an unknown id', async () => {
    const cookie = await signUpCoach(5101);
    const created = await createTransaction(cookie);

    const empty = await callJson<{ error: string }>(
      `/api/finance/transactions/${created.body.transaction.id}`,
      { method: 'PATCH', cookie, body: JSON.stringify({}) },
    );
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('nothing_to_update');

    const missing = await callJson(
      '/api/finance/transactions/nope',
      { method: 'PATCH', cookie, body: JSON.stringify({ label: 'x' }) },
    );
    expect(missing.status).toBe(404);
  });

  it('answers 404, not 403, for another team\'s transaction', async () => {
    const cookieA = await signUpCoach(5102);
    const cookieB = await signUpCoach(5103);
    const created = await createTransaction(cookieA);

    const cross = await callJson(
      `/api/finance/transactions/${created.body.transaction.id}`,
      { method: 'PATCH', cookie: cookieB, body: JSON.stringify({ label: 'stolen' }) },
    );
    expect(cross.status).toBe(404);
  });

  it('validates kind, category-per-kind, amount and occurred_at', async () => {
    const cookie = await signUpCoach(5104);

    expect((await createTransaction(cookie, { kind: 'transfer' })).status).toBe(400);
    // 'parts' is an expense category and may not label income.
    const mismatch = await createTransaction(cookie, {
      kind: 'income',
      category: 'parts',
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toBe('invalid_category');

    expect((await createTransaction(cookie, { amount_cents: 0 })).status).toBe(400);
    expect((await createTransaction(cookie, { amount_cents: 12.5 })).status).toBe(400);
    expect((await createTransaction(cookie, { occurred_at: 'today' })).status).toBe(400);

    // The pair validates together on PATCH too: flipping kind must not strand
    // the old category.
    const created = await createTransaction(cookie);
    const flip = await callJson<{ error: string }>(
      `/api/finance/transactions/${created.body.transaction.id}`,
      { method: 'PATCH', cookie, body: JSON.stringify({ kind: 'income' }) },
    );
    expect(flip.status).toBe(400);
    expect(flip.body.error).toBe('invalid_category');
  });
});

// ---------------------------------------------------------------- visibility

describe('visibility', () => {
  it('lets every role read and only coach/mentor write the ledger', async () => {
    const coach = await signUpCoach(5105);
    const { cookie: student } = await inviteAndAccept(coach, {
      role: 'student',
      handle: 'fin-student',
    });
    const { cookie: viewer } = await inviteAndAccept(coach, {
      role: 'viewer',
      handle: 'fin-viewer',
    });
    await createTransaction(coach);

    // The decision: a viewer is a parent or a sponsor, and where the money
    // went is exactly what a sponsor is owed. Reads answer 200 for everyone.
    for (const cookie of [student, viewer]) {
      const list = await callJson<{ transactions: Transaction[] }>(
        '/api/finance/transactions',
        { cookie },
      );
      expect(list.status).toBe(200);
      expect(list.body.transactions).toHaveLength(1);
      expect((await callJson('/api/finance/summary', { cookie })).status).toBe(200);
      expect((await callJson('/api/finance/orders', { cookie })).status).toBe(200);
    }

    // Writes stay coach/mentor.
    expect((await createTransaction(student)).status).toBe(403);
    expect((await createTransaction(viewer)).status).toBe(403);
  });

  it('lets a student submit an order and refuses a viewer', async () => {
    const coach = await signUpCoach(5106);
    const { cookie: student } = await inviteAndAccept(coach, {
      role: 'student',
      handle: 'order-student',
    });
    const { cookie: viewer } = await inviteAndAccept(coach, {
      role: 'viewer',
      handle: 'order-viewer',
    });

    expect((await createOrder(student)).status).toBe(201);
    expect((await createOrder(viewer)).status).toBe(403);
  });
});

// ------------------------------------------------------------------ receipts

describe('receipts', () => {
  it('attaches an image and a PDF, and lists them on the transaction', async () => {
    const cookie = await signUpCoach(5107);
    const created = await createTransaction(cookie);
    const id = created.body.transaction.id;

    const image = await uploadReceipt(cookie, id, png(800, 600));
    expect(image.status).toBe(201);

    const pdfUpload = await uploadReceipt(cookie, id, pdf());
    expect(pdfUpload.status).toBe(201);
    const pdfBody = (await pdfUpload.json()) as {
      id: string;
      content_type: string;
      width: number | null;
    };
    expect(pdfBody.content_type).toBe('application/pdf');
    // Dimensions are an image concept; a PDF stores none.
    expect(pdfBody.width).toBeNull();

    const list = await callJson<{ transactions: Transaction[] }>(
      '/api/finance/transactions',
      { cookie },
    );
    const receipts = list.body.transactions[0].receipts ?? [];
    expect(receipts).toHaveLength(2);
    expect(receipts.filter((r) => r.is_pdf === 1)).toHaveLength(1);

    // A viewer may fetch the receipt bytes — same decision as the ledger read.
    const { cookie: viewer } = await inviteAndAccept(cookie, {
      role: 'viewer',
      handle: 'receipt-viewer',
    });
    const served = await call(`/media/${pdfBody.id}`, { cookie: viewer });
    expect(served.status).toBe(200);
    expect(served.headers.get('Content-Type')).toBe('application/pdf');
  });

  it('still refuses an SVG, and refuses PDF on the notes upload path', async () => {
    const cookie = await signUpCoach(5108);
    const created = await createTransaction(cookie);

    const svg = ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const refused = await uploadReceipt(cookie, created.body.transaction.id, svg);
    expect(refused.status).toBe(415);

    // The widened type list is receipts-only. The media route keeps its
    // image-only vocabulary, so notes cannot accumulate PDFs.
    const notesPath = await call('/api/media', {
      method: 'POST',
      cookie,
      headers: { 'Content-Type': 'application/pdf' },
      body: pdf() as unknown as BodyInit,
    });
    expect(notesPath.status).toBe(415);
  });

  it('keeps receipts out of the photo library and deletes them with the line', async () => {
    const cookie = await signUpCoach(5109);
    const created = await createTransaction(cookie);
    const id = created.body.transaction.id;
    await uploadReceipt(cookie, id, png(400, 300));

    const library = await callJson<{ media: { id: string }[] }>('/api/media', {
      cookie,
    });
    expect(library.body.media).toHaveLength(0);

    const receiptRow = await env.DB.prepare(
      "SELECT id, r2_key FROM media WHERE transaction_id = ? AND kind = 'receipt'",
    )
      .bind(id)
      .first<{ id: string; r2_key: string }>();
    expect(receiptRow).not.toBeNull();

    await callJson(`/api/finance/transactions/${id}`, { method: 'DELETE', cookie });

    const orphan = await env.DB.prepare('SELECT id FROM media WHERE id = ?')
      .bind(receiptRow!.id)
      .first();
    expect(orphan).toBeNull();
    expect(await env.MEDIA.get(receiptRow!.r2_key)).toBeNull();
  });
});

// ---------------------------------------------------------------- part orders

describe('part orders', () => {
  it('walks the whole ladder and books the expense at mark-ordered', async () => {
    const coach = await signUpCoach(5110);
    const { cookie: student } = await inviteAndAccept(coach, {
      role: 'student',
      handle: 'ladder-student',
    });

    const created = await createOrder(student);
    expect(created.status).toBe(201);
    const orderId = created.body.order.id;

    const approved = await callJson<{ order: Order }>(
      `/api/finance/orders/${orderId}/decision`,
      { method: 'POST', cookie: coach, body: JSON.stringify({ decision: 'approved' }) },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.order.status).toBe('approved');

    const ordered = await callJson<{ order: Order }>(
      `/api/finance/orders/${orderId}/ordered`,
      { method: 'POST', cookie: coach },
    );
    expect(ordered.status).toBe(200);
    expect(ordered.body.order.status).toBe('ordered');
    expect(ordered.body.order.transaction_id).not.toBeNull();

    // The booked line: qty × unit price, labelled from the item.
    const ledger = await callJson<{ transactions: Transaction[] }>(
      '/api/finance/transactions',
      { cookie: coach },
    );
    const booked = ledger.body.transactions.find(
      (t) => t.id === ordered.body.order.transaction_id,
    );
    expect(booked).toBeDefined();
    expect(booked!.kind).toBe('expense');
    expect(booked!.category).toBe('parts');
    expect(booked!.amount_cents).toBe(2 * 3999);
    expect(booked!.order_item).toBe('goBILDA 5203 servo');

    // A double press books once: the guard answers 409 and the ledger still
    // holds one line.
    const again = await callJson(`/api/finance/orders/${orderId}/ordered`, {
      method: 'POST',
      cookie: coach,
    });
    expect(again.status).toBe(409);
    const after = await callJson<{ transactions: Transaction[] }>(
      '/api/finance/transactions',
      { cookie: coach },
    );
    expect(after.body.transactions).toHaveLength(1);

    const received = await callJson<{ order: Order }>(
      `/api/finance/orders/${orderId}/received`,
      { method: 'POST', cookie: coach },
    );
    expect(received.status).toBe(200);
    expect(received.body.order.status).toBe('received');
  });

  it('records a denial with its note', async () => {
    const coach = await signUpCoach(5111);
    const created = await createOrder(coach);

    const denied = await callJson<{ order: Order }>(
      `/api/finance/orders/${created.body.order.id}/decision`,
      {
        method: 'POST',
        cookie: coach,
        body: JSON.stringify({ decision: 'denied', note: 'We have four already.' }),
      },
    );
    expect(denied.status).toBe(200);
    expect(denied.body.order.status).toBe('denied');
    expect(denied.body.order.decision_note).toBe('We have four already.');

    // Terminal: a denied order cannot be marked ordered.
    const dead = await callJson(
      `/api/finance/orders/${created.body.order.id}/ordered`,
      { method: 'POST', cookie: coach },
    );
    expect(dead.status).toBe(409);
  });

  it('enforces the cancel permission matrix', async () => {
    const coach = await signUpCoach(5112);
    const { cookie: requester } = await inviteAndAccept(coach, {
      role: 'student',
      handle: 'cancel-owner',
    });
    const { cookie: bystander } = await inviteAndAccept(coach, {
      role: 'student',
      handle: 'cancel-bystander',
    });

    // The requester may pull their own pending order.
    const mine = await createOrder(requester);
    const pulled = await callJson<{ order: Order }>(
      `/api/finance/orders/${mine.body.order.id}/cancel`,
      { method: 'POST', cookie: requester },
    );
    expect(pulled.status).toBe(200);
    expect(pulled.body.order.status).toBe('canceled');

    // Another student may not pull it for them.
    const theirs = await createOrder(requester);
    const meddled = await callJson(
      `/api/finance/orders/${theirs.body.order.id}/cancel`,
      { method: 'POST', cookie: bystander },
    );
    expect(meddled.status).toBe(403);

    // A coach may pull an approved order — intent, not yet money.
    await callJson(`/api/finance/orders/${theirs.body.order.id}/decision`, {
      method: 'POST',
      cookie: coach,
      body: JSON.stringify({ decision: 'approved' }),
    });
    const coachPull = await callJson<{ order: Order }>(
      `/api/finance/orders/${theirs.body.order.id}/cancel`,
      { method: 'POST', cookie: coach },
    );
    expect(coachPull.status).toBe(200);

    // Nobody cancels an ordered order — the money moved.
    const late = await createOrder(requester);
    await callJson(`/api/finance/orders/${late.body.order.id}/decision`, {
      method: 'POST',
      cookie: coach,
      body: JSON.stringify({ decision: 'approved' }),
    });
    await callJson(`/api/finance/orders/${late.body.order.id}/ordered`, {
      method: 'POST',
      cookie: coach,
    });
    const tooLate = await callJson(
      `/api/finance/orders/${late.body.order.id}/cancel`,
      { method: 'POST', cookie: coach },
    );
    expect(tooLate.status).toBe(409);
  });

  it('lets the requester edit while pending and freezes the row after', async () => {
    const coach = await signUpCoach(5113);
    const { cookie: requester } = await inviteAndAccept(coach, {
      role: 'student',
      handle: 'edit-owner',
    });
    const created = await createOrder(requester);

    const edited = await callJson<{ order: Order }>(
      `/api/finance/orders/${created.body.order.id}`,
      { method: 'PATCH', cookie: requester, body: JSON.stringify({ qty: 4 }) },
    );
    expect(edited.status).toBe(200);
    expect(edited.body.order.qty).toBe(4);

    await callJson(`/api/finance/orders/${created.body.order.id}/decision`, {
      method: 'POST',
      cookie: coach,
      body: JSON.stringify({ decision: 'approved' }),
    });
    const frozen = await callJson(
      `/api/finance/orders/${created.body.order.id}`,
      { method: 'PATCH', cookie: requester, body: JSON.stringify({ qty: 6 }) },
    );
    expect(frozen.status).toBe(409);
  });

  it('rejects a javascript: url', async () => {
    const coach = await signUpCoach(5114);
    const bad = await createOrder(coach, { url: 'javascript:alert(1)' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_url');
  });
});

// ------------------------------------------------------------- approver flag

describe('approver flag', () => {
  it('lets a flagged student decide and an unflagged one not', async () => {
    const coach = await signUpCoach(5115);
    const { cookie: treasurer } = await inviteAndAccept(coach, {
      role: 'student',
      handle: 'treasurer',
    });
    const { cookie: other } = await inviteAndAccept(coach, {
      role: 'student',
      handle: 'not-treasurer',
    });
    const treasurerId = (await whoami(treasurer)).member_id;

    const order = await createOrder(other);

    // Unflagged: submitting is theirs, deciding is not.
    const refused = await callJson(
      `/api/finance/orders/${order.body.order.id}/decision`,
      { method: 'POST', cookie: other, body: JSON.stringify({ decision: 'approved' }) },
    );
    expect(refused.status).toBe(403);

    // Coach grants the flag through the roster route.
    const granted = await callJson(`/api/members/${treasurerId}`, {
      method: 'PATCH',
      cookie: coach,
      body: JSON.stringify({ is_purchase_approver: true }),
    });
    expect(granted.status).toBe(200);

    const decided = await callJson<{ order: Order }>(
      `/api/finance/orders/${order.body.order.id}/decision`,
      {
        method: 'POST',
        cookie: treasurer,
        body: JSON.stringify({ decision: 'approved' }),
      },
    );
    expect(decided.status).toBe(200);
    expect(decided.body.order.status).toBe('approved');

    // And the flag shows on the roster, so the UI can render the toggle state.
    const members = await callJson<{ handle: string; is_purchase_approver: boolean }[]>(
      '/api/members',
      { cookie: coach },
    );
    const row = members.body.find((m) => m.handle === 'treasurer');
    expect(row?.is_purchase_approver).toBe(true);
  });

  it('refuses the flag route to a student', async () => {
    const coach = await signUpCoach(5116);
    const { cookie: student } = await inviteAndAccept(coach, {
      role: 'student',
      handle: 'flag-student',
    });
    const studentId = (await whoami(student)).member_id;

    const refused = await callJson(`/api/members/${studentId}`, {
      method: 'PATCH',
      cookie: student,
      body: JSON.stringify({ is_purchase_approver: true }),
    });
    expect(refused.status).toBe(403);
  });
});

// -------------------------------------------------------------------- summary

describe('summary', () => {
  it('sums the season to exact cents', async () => {
    const coach = await signUpCoach(5117);
    await createTransaction(coach, {
      kind: 'income',
      category: 'fundraising',
      label: 'Car wash',
      amount_cents: 41500,
    });
    await createTransaction(coach, { amount_cents: 31240 });
    await createOrder(coach, { qty: 3, unit_price_cents: 1000 });

    const summary = await callJson<{
      income_cents: number;
      expense_cents: number;
      pending_orders: number;
      pending_estimate_cents: number;
    }>('/api/finance/summary', { cookie: coach });

    expect(summary.body.income_cents).toBe(41500);
    expect(summary.body.expense_cents).toBe(31240);
    expect(summary.body.pending_orders).toBe(1);
    expect(summary.body.pending_estimate_cents).toBe(3000);
  });
});

// ----------------------------------------------------------------- breakdown

interface CategoryTotal {
  category: string;
  total_cents: number;
  line_count: number;
}
interface Bucket {
  y: number;
  m: number;
  income_cents: number;
  expense_cents: number;
  balance_cents: number;
  line_count: number;
}
interface Breakdown {
  by_category: CategoryTotal[];
  buckets: Bucket[];
  opening_cents: number;
}
interface Summary {
  income_cents: number;
  expense_cents: number;
  opening_cents: number;
}

/**
 * Dates have to be built from the CURRENT season, not written as literals.
 * A signup creates the season Sept 1 - May 31 around `now` (auth.ts
 * currentSeason), so a hardcoded 2025 date silently falls outside the season
 * once the calendar rolls and folds into the ladder's leading edge -- which
 * makes these tests pass for the wrong reason rather than fail.
 */
const SEASON_START_YEAR = new Date(
  currentSeason(Math.floor(Date.now() / 1000)).starts_at * 1000,
).getUTCFullYear();

/** A UTC instant in the current season. `m` is a calendar month, Sept = 9. */
const inSeason = (m: number, d: number, hh = 12) =>
  Math.floor(
    Date.UTC(m >= 9 ? SEASON_START_YEAR : SEASON_START_YEAR + 1, m - 1, d, hh) / 1000,
  );

describe('breakdown', () => {
  it('rolls expenses up by category, biggest first', async () => {
    const cookie = await signUpCoach(5140);

    await createTransaction(cookie, { category: 'parts', amount_cents: 10000 });
    await createTransaction(cookie, { category: 'parts', amount_cents: 5000 });
    await createTransaction(cookie, { category: 'travel', amount_cents: 40000 });
    await createTransaction(cookie, {
      kind: 'income',
      category: 'sponsorship',
      amount_cents: 90000,
    });

    const res = await callJson<Breakdown>('/api/finance/breakdown', { cookie });
    expect(res.status).toBe(200);

    // Income must not leak into the expense rollup, and the order is the
    // answer to "where did it go" -- so it is asserted, not incidental.
    expect(res.body.by_category).toEqual([
      { category: 'travel', total_cents: 40000, line_count: 1 },
      { category: 'parts', total_cents: 15000, line_count: 2 },
    ]);
  });

  /**
   * The invariant that matters most: the chart's last balance point and the
   * Balance tile are the same number reached by different arithmetic. If this
   * fails, a chart is disagreeing with the tile 200px above it.
   */
  it("ends at the same balance the summary reports", async () => {
    const cookie = await signUpCoach(5141);

    await createTransaction(cookie, {
      kind: 'income',
      category: 'opening_balance',
      amount_cents: 250000,
      occurred_at: inSeason(9, 5),
    });
    await createTransaction(cookie, {
      kind: 'income',
      category: 'fundraising',
      amount_cents: 60000,
      occurred_at: inSeason(11, 12),
    });
    await createTransaction(cookie, {
      category: 'registration',
      amount_cents: 82500,
      occurred_at: inSeason(10, 2),
    });
    await createTransaction(cookie, {
      category: 'parts',
      amount_cents: 31240,
      occurred_at: inSeason(2, 20),
    });

    const [breakdown, summary] = await Promise.all([
      callJson<Breakdown>('/api/finance/breakdown', { cookie }),
      callJson<Summary>('/api/finance/summary', { cookie }),
    ]);

    const tile =
      summary.body.opening_cents + summary.body.income_cents - summary.body.expense_cents;
    const last = breakdown.body.buckets[breakdown.body.buckets.length - 1];
    expect(last.balance_cents).toBe(tile);
    expect(last.balance_cents).toBe(250000 + 60000 - 82500 - 31240);
  });

  it('carries the reserve as opening_cents, not as income', async () => {
    const cookie = await signUpCoach(5142);

    await createTransaction(cookie, {
      kind: 'income',
      category: 'opening_balance',
      amount_cents: 120000,
      occurred_at: inSeason(9, 10),
    });
    await createTransaction(cookie, {
      kind: 'income',
      category: 'grant',
      amount_cents: 45000,
      occurred_at: inSeason(9, 20),
    });

    const res = await callJson<Breakdown>('/api/finance/breakdown', { cookie });
    const september = res.body.buckets[0];
    expect(res.body.opening_cents).toBe(120000);
    expect(september.income_cents).toBe(45000);
    // Both still move the running balance -- the reserve is really in the bank.
    expect(september.balance_cents).toBe(165000);
  });

  it('zero-fills the months nothing happened in', async () => {
    const cookie = await signUpCoach(5143);

    await createTransaction(cookie, {
      category: 'parts',
      amount_cents: 10000,
      occurred_at: inSeason(9, 15),
    });

    const res = await callJson<Breakdown>('/api/finance/breakdown', { cookie });
    // Sept through May: nine columns, however few lines exist. A skipped month
    // would make the x-axis non-uniform and the shape a lie.
    expect(res.body.buckets).toHaveLength(9);
    expect(res.body.buckets.map((b) => b.m)).toEqual([9, 10, 11, 12, 1, 2, 3, 4, 5]);
    expect(res.body.buckets[1]).toMatchObject({ line_count: 0, expense_cents: 0 });
    // The balance carries forward across the empty months rather than resetting.
    expect(res.body.buckets.every((b) => b.balance_cents === -10000)).toBe(true);
  });

  /**
   * The regression that finding #3 exists to prevent. 2025-11-01 00:30 UTC is
   * still 2025-10-31 20:30 in New York, so a UTC bucket puts this in November
   * and the team sees October money in the wrong column.
   */
  it('buckets by the team timezone, not UTC', async () => {
    const cookie = await signUpCoach(5144);

    await createTransaction(cookie, {
      category: 'parts',
      amount_cents: 7700,
      occurred_at: inSeason(11, 1, 0) + 30 * 60,
    });

    const res = await callJson<Breakdown>('/api/finance/breakdown', { cookie });
    const october = res.body.buckets.find((b) => b.m === 10);
    const november = res.body.buckets.find((b) => b.m === 11);
    expect(october?.expense_cents).toBe(7700);
    expect(november?.expense_cents).toBe(0);
  });

  it('is readable by a viewer', async () => {
    const cookie = await signUpCoach(5145);
    await createTransaction(cookie);
    const { cookie: viewer } = await inviteAndAccept(cookie, {
      role: 'viewer',
      handle: 'breakdownviewer',
    });

    const res = await callJson<Breakdown>('/api/finance/breakdown', {
      cookie: viewer,
    });
    expect(res.status).toBe(200);
    expect(res.body.by_category).toHaveLength(1);
  });
});
