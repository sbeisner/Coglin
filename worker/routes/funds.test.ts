/**
 * Funds: which pot money came out of, and which pots are about to expire.
 *
 * Three groups here are pins on decisions rather than coverage:
 *
 *   - INCOME EXCLUDES OPENING BALANCES while BALANCE includes them. A
 *     regression that folds a reserve back into income would overstate what
 *     the team raised in the one figure a Sustain narrative quotes.
 *   - NOTHING EXPIRES ANYTHING. An expired fund is a predicate evaluated at
 *     read time, never a stored status, so a fund whose date has passed is
 *     still exactly the row the team left there.
 *   - A FUND'S BALANCE IS NOT SEASON-FILTERED. The fund is its own scope, and
 *     a second season's rows still count toward it.
 */
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { callJson, inviteAndAccept, signUpCoach, stubResend, whoami } from './_helpers';

beforeAll(() => {
  stubResend();
});

const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);

interface Fund {
  id: string;
  name: string;
  note: string | null;
  expires_at: number | null;
  is_default: number;
  income_cents: number;
  expense_cents: number;
  transaction_count: number;
}

interface FundsResponse {
  funds: Fund[];
  unassigned: { income_cents: number; expense_cents: number; transaction_count: number };
  error?: string;
}

interface Summary {
  income_cents: number;
  expense_cents: number;
  opening_cents: number;
  expiring: { id: string; name: string; remaining_cents: number; expires_at: number }[];
}

async function makeFund(
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: { fund: Fund; error?: string } }> {
  return callJson('/api/finance/funds', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ name: 'District allocation FY26', ...overrides }),
  });
}

async function makeTransaction(
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: { transaction: { id: string; fund_id: string | null }; error?: string } }> {
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

const listFunds = (cookie: string) =>
  callJson<FundsResponse>('/api/finance/funds', { cookie });

const summary = (cookie: string) =>
  callJson<Summary>('/api/finance/summary', { cookie });

// ----------------------------------------------------------------------- CRUD

describe('funds', () => {
  it('creates, lists, edits and deletes a fund', async () => {
    const cookie = await signUpCoach(8100);

    const created = await makeFund(cookie, { note: 'Spend by the fiscal year end.' });
    expect(created.status).toBe(201);
    // The first fund is the default whether or not anybody asked: a team with
    // one pot should never meet the concept.
    expect(created.body.fund.is_default).toBe(1);

    const list = await listFunds(cookie);
    expect(list.status).toBe(200);
    expect(list.body.funds).toHaveLength(1);
    expect(list.body.funds[0].income_cents).toBe(0);

    const patched = await callJson<{ fund: Fund }>(
      `/api/finance/funds/${created.body.fund.id}`,
      { method: 'PATCH', cookie, body: JSON.stringify({ name: 'District FY26' }) },
    );
    expect(patched.status).toBe(200);
    expect(patched.body.fund.name).toBe('District FY26');

    const deleted = await callJson(`/api/finance/funds/${created.body.fund.id}`, {
      method: 'DELETE',
      cookie,
    });
    expect(deleted.status).toBe(200);
  });

  it('validates the name and the deadline, and caps the count', async () => {
    const cookie = await signUpCoach(8101);
    expect((await makeFund(cookie, { name: '   ' })).status).toBe(400);
    expect((await makeFund(cookie, { expires_at: 'June' })).status).toBe(400);

    for (let i = 0; i < 20; i++) {
      expect((await makeFund(cookie, { name: `Fund ${i}` })).status).toBe(201);
    }
    const overflow = await makeFund(cookie, { name: 'One too many' });
    expect(overflow.status).toBe(409);
    expect(overflow.body.error).toBe('too_many_funds');
  });

  it('keeps exactly one default', async () => {
    const cookie = await signUpCoach(8102);
    const teamId = (await whoami(cookie)).team_id;
    const first = (await makeFund(cookie, { name: 'Reserve' })).body.fund;
    const second = (await makeFund(cookie, { name: 'District' })).body.fund;
    expect(second.is_default).toBe(0);

    const moved = await callJson<FundsResponse>(
      `/api/finance/funds/${second.id}/default`,
      { method: 'POST', cookie },
    );
    expect(moved.status).toBe(200);

    const defaults = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM funds WHERE team_id = ? AND is_default = 1',
    )
      .bind(teamId)
      .first<{ n: number }>();
    expect(defaults?.n).toBe(1);
    expect(moved.body.funds.find((f) => f.id === second.id)?.is_default).toBe(1);
    expect(moved.body.funds.find((f) => f.id === first.id)?.is_default).toBe(0);

    // Creating one WITH is_default also clears the incumbent.
    const third = await makeFund(cookie, { name: 'Grant', is_default: true });
    expect(third.body.fund.is_default).toBe(1);
    const after = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM funds WHERE team_id = ? AND is_default = 1',
    )
      .bind(teamId)
      .first<{ n: number }>();
    expect(after?.n).toBe(1);
  });

  it('converts a deadline on and off', async () => {
    const cookie = await signUpCoach(8103);
    const fund = (await makeFund(cookie, { expires_at: now() + 30 * DAY })).body.fund;
    expect(fund.expires_at).not.toBeNull();

    // Use-or-lose → carries over. A real correction.
    const carryover = await callJson<{ fund: Fund }>(
      `/api/finance/funds/${fund.id}`,
      { method: 'PATCH', cookie, body: JSON.stringify({ expires_at: null }) },
    );
    expect(carryover.body.fund.expires_at).toBeNull();

    const back = await callJson<{ fund: Fund }>(`/api/finance/funds/${fund.id}`, {
      method: 'PATCH',
      cookie,
      body: JSON.stringify({ expires_at: now() + 10 * DAY }),
    });
    expect(back.body.fund.expires_at).not.toBeNull();
  });

  it('refuses to delete a fund that ledger lines point at', async () => {
    const cookie = await signUpCoach(8104);
    const fund = (await makeFund(cookie)).body.fund;
    const line = await makeTransaction(cookie, { fund_id: fund.id });
    expect(line.body.transaction.fund_id).toBe(fund.id);

    const refused = await callJson<{ error: string }>(
      `/api/finance/funds/${fund.id}`,
      { method: 'DELETE', cookie },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('fund_in_use');

    // Re-file the line, then the pot can go.
    await callJson(`/api/finance/transactions/${line.body.transaction.id}`, {
      method: 'PATCH',
      cookie,
      body: JSON.stringify({ fund_id: null }),
    });
    expect(
      (await callJson(`/api/finance/funds/${fund.id}`, { method: 'DELETE', cookie }))
        .status,
    ).toBe(200);
  });
});

// -------------------------------------------------------------------- balances

describe('balances', () => {
  it('sums income minus expense per fund and tracks the unassigned pot', async () => {
    const cookie = await signUpCoach(8110);
    const fund = (await makeFund(cookie, { name: 'District' })).body.fund;

    await makeTransaction(cookie, {
      kind: 'income',
      category: 'grant',
      label: 'District allocation',
      amount_cents: 150000,
      fund_id: fund.id,
    });
    await makeTransaction(cookie, { amount_cents: 31240, fund_id: fund.id });
    // Deliberately unassigned.
    await makeTransaction(cookie, { amount_cents: 4599, fund_id: null });

    const list = await listFunds(cookie);
    const row = list.body.funds.find((f) => f.id === fund.id)!;
    expect(row.income_cents).toBe(150000);
    expect(row.expense_cents).toBe(31240);
    expect(row.transaction_count).toBe(2);

    expect(list.body.unassigned.expense_cents).toBe(4599);
    expect(list.body.unassigned.transaction_count).toBe(1);
  });

  it('is not season-filtered — the fund is its own scope', async () => {
    const cookie = await signUpCoach(8111);
    const teamId = (await whoami(cookie)).team_id;
    const fund = (await makeFund(cookie, { name: 'Carryover' })).body.fund;

    await makeTransaction(cookie, {
      kind: 'income',
      category: 'fundraising',
      label: 'This season',
      amount_cents: 20000,
      fund_id: fund.id,
    });

    // A row belonging to a DIFFERENT season, written directly because no route
    // can create a second season today. Carryover money is exactly the case
    // that must still count.
    await env.DB.prepare(
      `INSERT INTO seasons (id, team_id, label, starts_at, ends_at, is_current)
       VALUES ('s-old-8111', ?, '2024-25', 1, 2, 0)`,
    )
      .bind(teamId)
      .run();
    await env.DB.prepare(
      `INSERT INTO transactions
         (id, team_id, season_id, kind, category, label, amount_cents,
          occurred_at, fund_id, created_at, updated_at)
       VALUES ('t-old-8111', ?, 's-old-8111', 'income', 'fundraising',
               'Last season', 5000, 1, ?, 1, 1)`,
    )
      .bind(teamId, fund.id)
      .run();

    const list = await listFunds(cookie);
    const row = list.body.funds.find((f) => f.id === fund.id)!;
    expect(row.income_cents).toBe(25000);
  });
});

// ------------------------------------------------------- the three write sites

describe('write sites', () => {
  it('falls back to the default fund, and refuses another team\'s', async () => {
    const cookie = await signUpCoach(8120);
    const other = await signUpCoach(8121);
    const theirFund = (await makeFund(other, { name: 'Theirs' })).body.fund;
    const mine = (await makeFund(cookie, { name: 'Mine' })).body.fund;

    // No fund named → the default.
    const implicit = await makeTransaction(cookie);
    expect(implicit.body.transaction.fund_id).toBe(mine.id);

    // Explicit null → unassigned, which is a deliberate choice.
    const unassigned = await makeTransaction(cookie, { fund_id: null });
    expect(unassigned.body.transaction.fund_id).toBeNull();

    // Another team's pot → refused rather than silently landing nowhere.
    const cross = await makeTransaction(cookie, { fund_id: theirFund.id });
    expect(cross.status).toBe(400);
    expect(cross.body.error).toBe('invalid_fund');
  });

  it('books a part order to the default fund', async () => {
    const cookie = await signUpCoach(8122);
    const fund = (await makeFund(cookie, { name: 'District' })).body.fund;

    const order = await callJson<{ order: { id: string } }>('/api/finance/orders', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ item: 'goBILDA servo', qty: 2, unit_price_cents: 3999 }),
    });
    await callJson(`/api/finance/orders/${order.body.order.id}/decision`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ decision: 'approved' }),
    });
    const ordered = await callJson<{ order: { transaction_id: string } }>(
      `/api/finance/orders/${order.body.order.id}/ordered`,
      { method: 'POST', cookie },
    );
    expect(ordered.status).toBe(200);

    const booked = await env.DB.prepare(
      'SELECT fund_id FROM transactions WHERE id = ?',
    )
      .bind(ordered.body.order.transaction_id)
      .first<{ fund_id: string | null }>();
    expect(booked?.fund_id).toBe(fund.id);
  });

  it('lets a sponsor payment name its fund', async () => {
    const cookie = await signUpCoach(8123);
    const reserve = (await makeFund(cookie, { name: 'Reserve' })).body.fund;
    const district = (await makeFund(cookie, { name: 'District' })).body.fund;

    const sponsor = await callJson<{ sponsor: { id: string } }>(
      '/api/finance/sponsors',
      {
        method: 'POST',
        cookie,
        body: JSON.stringify({ name: 'Harbor Machine', amount_cents: 50000 }),
      },
    );

    const named = await callJson<{ transaction: { id: string } }>(
      `/api/finance/sponsors/${sponsor.body.sponsor.id}/payments`,
      {
        method: 'POST',
        cookie,
        body: JSON.stringify({
          amount_cents: 25000,
          occurred_at: 1_760_000_000,
          fund_id: district.id,
        }),
      },
    );
    expect(named.status).toBe(201);
    const row = await env.DB.prepare('SELECT fund_id FROM transactions WHERE id = ?')
      .bind(named.body.transaction.id)
      .first<{ fund_id: string }>();
    expect(row?.fund_id).toBe(district.id);

    // Omitted → the default, which is the reserve here.
    const implicit = await callJson<{ transaction: { id: string } }>(
      `/api/finance/sponsors/${sponsor.body.sponsor.id}/payments`,
      {
        method: 'POST',
        cookie,
        body: JSON.stringify({ amount_cents: 25000, occurred_at: 1_760_000_000 }),
      },
    );
    const fallback = await env.DB.prepare(
      'SELECT fund_id FROM transactions WHERE id = ?',
    )
      .bind(implicit.body.transaction.id)
      .first<{ fund_id: string }>();
    expect(fallback?.fund_id).toBe(reserve.id);
  });
});

// --------------------------------------------------------------------- expiry

describe('expiry', () => {
  it('warns about money that is about to disappear, and only that', async () => {
    const cookie = await signUpCoach(8130);
    const soon = (await makeFund(cookie, { name: 'Expiring soon', expires_at: now() + 41 * DAY }))
      .body.fund;
    const far = (await makeFund(cookie, { name: 'Expiring later', expires_at: now() + 200 * DAY }))
      .body.fund;
    const carryover = (await makeFund(cookie, { name: 'Carryover' })).body.fund;
    const emptySoon = (await makeFund(cookie, { name: 'Empty', expires_at: now() + 20 * DAY }))
      .body.fund;

    for (const id of [soon.id, far.id, carryover.id]) {
      await makeTransaction(cookie, {
        kind: 'income',
        category: 'grant',
        label: 'Allocation',
        amount_cents: 100000,
        fund_id: id,
      });
    }
    await makeTransaction(cookie, { amount_cents: 65900, fund_id: soon.id });

    const s = await summary(cookie);
    expect(s.status).toBe(200);
    const names = s.body.expiring.map((e) => e.name);
    // Inside the window with money left.
    expect(names).toContain('Expiring soon');
    // Outside the window, no deadline at all, and nothing left respectively.
    expect(names).not.toContain('Expiring later');
    expect(names).not.toContain('Carryover');
    expect(names).not.toContain('Empty');

    const warned = s.body.expiring.find((e) => e.id === soon.id)!;
    expect(warned.remaining_cents).toBe(100000 - 65900);
    expect(emptySoon.id).toBeTruthy();
  });

  it('drops an expired fund out of the warning and writes nothing', async () => {
    const cookie = await signUpCoach(8131);
    const fund = (await makeFund(cookie, { name: 'Gone', expires_at: now() - 5 * DAY }))
      .body.fund;
    await makeTransaction(cookie, {
      kind: 'income',
      category: 'grant',
      label: 'Allocation',
      amount_cents: 34000,
      fund_id: fund.id,
    });

    const s = await summary(cookie);
    expect(s.body.expiring).toHaveLength(0);

    // The pin: expiry is a predicate at read time, never a stored status. The
    // row is exactly what the team left there, money and all, so the screen can
    // say what was forfeited.
    const row = await env.DB.prepare(
      'SELECT expires_at FROM funds WHERE id = ?',
    )
      .bind(fund.id)
      .first<{ expires_at: number }>();
    expect(row?.expires_at).toBeLessThan(now());
    const list = await listFunds(cookie);
    expect(list.body.funds.find((f) => f.id === fund.id)?.income_cents).toBe(34000);
  });
});

// ----------------------------------------------------------------- initialize

describe('initialize', () => {
  it('sets up a reserve and an expiring pot with their opening balances', async () => {
    const cookie = await signUpCoach(8140);

    const result = await callJson<FundsResponse & { created: number }>(
      '/api/finance/funds/initialize',
      {
        method: 'POST',
        cookie,
        body: JSON.stringify({
          reserve_cents: 120000,
          funds: [
            { name: 'District allocation FY26', amount_cents: 34000, expires_at: now() + 45 * DAY },
          ],
        }),
      },
    );
    expect(result.status).toBe(201);
    expect(result.body.created).toBe(2);

    const reserve = result.body.funds.find((f) => f.name === 'Reserve')!;
    // The reserve carries over, is the default, and holds what was entered.
    expect(reserve.expires_at).toBeNull();
    expect(reserve.is_default).toBe(1);
    expect(reserve.income_cents).toBe(120000);

    const district = result.body.funds.find((f) => f.name === 'District allocation FY26')!;
    expect(district.expires_at).not.toBeNull();
    expect(district.income_cents).toBe(34000);

    // The openings are real ledger rows, visible and explicable.
    const ledger = await callJson<{
      transactions: { category: string; label: string; fund_name: string | null }[];
    }>('/api/finance/transactions', { cookie });
    const openings = ledger.body.transactions.filter(
      (t) => t.category === 'opening_balance',
    );
    expect(openings).toHaveLength(2);
    expect(openings.map((o) => o.fund_name).sort()).toEqual(
      ['District allocation FY26', 'Reserve'].sort(),
    );
  });

  it('runs once and refuses a second time', async () => {
    const cookie = await signUpCoach(8141);
    const body = JSON.stringify({ reserve_cents: 50000 });
    expect(
      (await callJson('/api/finance/funds/initialize', { method: 'POST', cookie, body }))
        .status,
    ).toBe(201);

    const again = await callJson<{ error: string }>('/api/finance/funds/initialize', {
      method: 'POST',
      cookie,
      body,
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already_initialized');

    // And nothing was doubled.
    const list = await listFunds(cookie);
    expect(list.body.funds).toHaveLength(1);
    expect(list.body.funds[0].income_cents).toBe(50000);
  });

  it('refuses an empty initialisation rather than burning the one shot', async () => {
    const cookie = await signUpCoach(8142);
    const empty = await callJson<{ error: string }>('/api/finance/funds/initialize', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ funds: [] }),
    });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('nothing_to_initialize');

    // Still available afterwards.
    expect(
      (await callJson('/api/finance/funds/initialize', {
        method: 'POST',
        cookie,
        body: JSON.stringify({ reserve_cents: 1000 }),
      })).status,
    ).toBe(201);
  });
});

// -------------------------------------------------- income versus balance pin

describe('opening balances in the summary', () => {
  it('excludes them from income and keeps them in the balance', async () => {
    const cookie = await signUpCoach(8150);
    await callJson('/api/finance/funds/initialize', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ reserve_cents: 120000 }),
    });
    // Raised this season.
    await makeTransaction(cookie, {
      kind: 'income',
      category: 'fundraising',
      label: 'Car wash',
      amount_cents: 85000,
    });
    await makeTransaction(cookie, { amount_cents: 31240 });

    const s = await summary(cookie);
    // The decision, pinned: income is what the team RAISED.
    expect(s.body.income_cents).toBe(85000);
    expect(s.body.opening_cents).toBe(120000);
    expect(s.body.expense_cents).toBe(31240);
    // And the balance is all of it, because the reserve is really there.
    expect(
      s.body.opening_cents + s.body.income_cents - s.body.expense_cents,
    ).toBe(120000 + 85000 - 31240);
  });
});

// ---------------------------------------------------------------- permissions

describe('visibility and permissions', () => {
  it('lets every role read and only coach/mentor write', async () => {
    const coach = await signUpCoach(8160);
    const { cookie: student } = await inviteAndAccept(coach, {
      role: 'student',
      handle: 'fund-student',
    });
    const { cookie: viewer } = await inviteAndAccept(coach, {
      role: 'viewer',
      handle: 'fund-viewer',
    });
    const fund = (await makeFund(coach)).body.fund;

    for (const cookie of [student, viewer]) {
      expect((await listFunds(cookie)).status).toBe(200);
      expect((await summary(cookie)).status).toBe(200);
    }

    // Funds are the ledger's structure, so they are adult territory — unlike
    // the sponsorship pipeline, which students own.
    for (const cookie of [student, viewer]) {
      expect((await makeFund(cookie, { name: 'Nope' })).status).toBe(403);
      expect(
        (await callJson(`/api/finance/funds/${fund.id}`, {
          method: 'PATCH',
          cookie,
          body: JSON.stringify({ name: 'Mine' }),
        })).status,
      ).toBe(403);
      expect(
        (await callJson('/api/finance/funds/initialize', {
          method: 'POST',
          cookie,
          body: JSON.stringify({ reserve_cents: 100 }),
        })).status,
      ).toBe(403);
    }
  });

  it("answers 404 for another team's fund", async () => {
    const cookieA = await signUpCoach(8161);
    const cookieB = await signUpCoach(8162);
    const fund = (await makeFund(cookieA)).body.fund;

    for (const init of [
      { method: 'PATCH', body: JSON.stringify({ name: 'Mine now' }) },
      { method: 'DELETE' },
    ] as const) {
      const response = await callJson(`/api/finance/funds/${fund.id}`, {
        ...(init as Record<string, unknown>),
        cookie: cookieB,
      });
      expect(response.status).toBe(404);
    }

    expect(
      (await callJson(`/api/finance/funds/${fund.id}/default`, {
        method: 'POST',
        cookie: cookieB,
      })).status,
    ).toBe(404);

    // And it does not appear in their list at all.
    expect((await listFunds(cookieB)).body.funds).toHaveLength(0);
  });
});
