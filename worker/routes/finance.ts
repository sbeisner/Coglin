/**
 * The ledger and the part-order queue (COG-0xx, finance phase 1).
 *
 * VISIBILITY: every GET here is plain `requireMember` — viewers included, on
 * purpose. A viewer is a parent or a sponsor, and where the team's money went
 * is exactly the thing a sponsor is owed. That is the opposite call from
 * action items (records.ts:16-36) because the contents are the opposite kind:
 * a ledger line is "REV kit restock, $312.40", which names no student and
 * embarrasses nobody. Being wrong toward "included" here costs an outsider
 * seeing a parts bill.
 *
 * WRITES are narrower, and split by what the write is:
 *   - The ledger itself is coach/mentor. The book of record is an adult's
 *     signature — a student who spots a wrong amount tells the coach, the same
 *     way attendance works.
 *   - Submitting a part order is any member except a viewer. Capturing "we
 *     need two more servos" from the student in the pit is the entire point.
 *   - Deciding, ordering, receiving and cancelling other people's orders is
 *     `canApproveOrders`: coach, mentor, or any member a coach has flagged —
 *     the treasurer is often a student. See lib/finance.ts.
 *
 * The order status ladder is guarded in SQL, not just checked and then
 * written: every transition UPDATE carries `AND status = '<expected>'`, so two
 * approvers racing produce one transition and one 409 rather than a double
 * write. Mark-ordered is the promote pattern from action items — one batch
 * INSERTs the expense line and sets `transaction_id` behind an `AND
 * transaction_id IS NULL` guard, so a double press cannot book the spend
 * twice.
 */
import { Hono } from 'hono';
import { nowSeconds, uuid } from '../lib/crypto';
import { boundedInt, optionalString, readJson } from '../lib/http';
import {
  canApproveOrders,
  isCategoryForKind,
  isTransactionKind,
  MAX_AMOUNT_CENTS,
  MAX_EPOCH,
  OPENING_BALANCE_CATEGORY,
  type TransactionKind,
} from '../lib/finance';
import { defaultFundId, EXPIRY_WARNING_SECONDS, resolveFundId } from '../lib/funds';
import { RECEIPT_TYPES } from '../lib/images';
import { ingestImage, MAX_BYTES } from './media';
import {
  auth as authOf,
  denyRole,
  requireMember,
  requireRole,
  sameOriginOnly,
  type AppEnv,
} from '../lib/tenancy';
import type { MiddlewareHandler } from 'hono';

const finance = new Hono<AppEnv>();

const TRANSACTION_COLUMNS = `id, kind, category, label, note, amount_cents,
        occurred_at, fund_id, sponsor_id, created_by, created_at, updated_at`;

const ORDER_COLUMNS = `id, item, description, url, vendor, qty,
        unit_price_cents, status, requested_by, decided_by, decided_at,
        decision_note, ordered_by, ordered_at, received_by, received_at,
        transaction_id, created_at, updated_at`;

/**
 * The approval gate as middleware, so "who may do this" stays visible in the
 * route table the way requireRole keeps it. Not a role check — see
 * canApproveOrders for what it actually is.
 */
const requireApprover: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!canApproveOrders(authOf(c).member)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  await next();
};

async function currentSeason(
  c: { env: { DB: D1Database } },
  teamId: string,
): Promise<{ id: string } | null> {
  return c.env.DB.prepare(
    'SELECT id FROM seasons WHERE team_id = ? AND is_current = 1',
  )
    .bind(teamId)
    .first<{ id: string }>();
}

// -------------------------------------------------------------- transactions

/**
 * The season's ledger, newest movement first.
 *
 * Receipts ride along from one grouped query rather than N — the ledger screen
 * needs the chip, not another request per row. `is_pdf` is derived from the
 * R2 key because the media table stores no content type; the key's extension
 * is written from the sniffed type at ingest, so it is the truth here.
 *
 * The part_orders LEFT JOIN is provenance: a line the order queue booked shows
 * "from a part order" rather than looking hand-typed.
 */
finance.get('/transactions', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const season = await currentSeason(c, teamId);
  if (!season) return c.json({ transactions: [] });

  const [lines, receipts] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT t.id AS id, t.kind AS kind, t.category AS category,
              t.label AS label, t.note AS note, t.amount_cents AS amount_cents,
              t.occurred_at AS occurred_at, t.created_by AS created_by,
              t.created_at AS created_at, t.updated_at AS updated_at,
              po.id AS order_id, po.item AS order_item,
              t.fund_id AS fund_id, fu.name AS fund_name,
              t.sponsor_id AS sponsor_id, sp.name AS sponsor_name
         FROM transactions t
         LEFT JOIN part_orders po
           ON po.transaction_id = t.id AND po.team_id = t.team_id
         LEFT JOIN funds fu ON fu.id = t.fund_id AND fu.team_id = t.team_id
         LEFT JOIN sponsors sp ON sp.id = t.sponsor_id AND sp.team_id = t.team_id
        WHERE t.team_id = ? AND t.season_id = ?
        ORDER BY t.occurred_at DESC, t.created_at DESC
        LIMIT 500`,
    ).bind(teamId, season.id),
    c.env.DB.prepare(
      `SELECT id, transaction_id, bytes,
              CASE WHEN r2_key LIKE '%.pdf' THEN 1 ELSE 0 END AS is_pdf
         FROM media
        WHERE team_id = ? AND kind = 'receipt' AND transaction_id IS NOT NULL`,
    ).bind(teamId),
  ]);

  const byTransaction = new Map<string, unknown[]>();
  for (const r of receipts.results as {
    id: string;
    transaction_id: string;
    bytes: number;
    is_pdf: number;
  }[]) {
    const list = byTransaction.get(r.transaction_id) ?? [];
    list.push({ id: r.id, bytes: r.bytes, is_pdf: r.is_pdf });
    byTransaction.set(r.transaction_id, list);
  }

  return c.json({
    transactions: (lines.results as { id: string }[]).map((t) => ({
      ...t,
      receipts: byTransaction.get(t.id) ?? [],
    })),
  });
});

finance.post(
  '/transactions',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);

    if (!isTransactionKind(body.kind)) {
      return c.json({ error: 'invalid_kind' }, 400);
    }
    if (!isCategoryForKind(body.kind, body.category)) {
      return c.json({ error: 'invalid_category' }, 400);
    }
    const label = optionalString(body.label, 200);
    if (!label) return c.json({ error: 'missing_label' }, 400);
    const amount = boundedInt(body.amount_cents, 1, MAX_AMOUNT_CENTS);
    if (amount === null) return c.json({ error: 'invalid_amount' }, 400);
    const occurredAt = boundedInt(body.occurred_at, 0, MAX_EPOCH);
    if (occurredAt === null) return c.json({ error: 'invalid_occurred_at' }, 400);

    const season = await currentSeason(c, teamId);
    if (!season) return c.json({ error: 'no_current_season' }, 409);

    // Which pot this came out of: the one named, else the team's default, else
    // unassigned for a team that does not track pots. See lib/funds.ts.
    const fund = await resolveFundId(c.env.DB, teamId, body.fund_id as string | null | undefined);
    if ('error' in fund) return c.json({ error: fund.error }, 400);

    const id = uuid();
    const now = nowSeconds();
    await c.env.DB.prepare(
      `INSERT INTO transactions
         (id, team_id, season_id, kind, category, label, note, amount_cents,
          occurred_at, fund_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        teamId,
        season.id,
        body.kind,
        body.category,
        label,
        optionalString(body.note, 1000),
        amount,
        occurredAt,
        fund.fundId,
        member.id,
        now,
        now,
      )
      .run();

    const row = await c.env.DB.prepare(
      `SELECT ${TRANSACTION_COLUMNS} FROM transactions WHERE id = ? AND team_id = ?`,
    )
      .bind(id, teamId)
      .first();
    return c.json(
      { transaction: { ...row, order_id: null, order_item: null, receipts: [] } },
      201,
    );
  },
);

finance.patch(
  '/transactions/:id',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId } = authOf(c);

    // kind and category validate as a PAIR, and either may be the one changing,
    // so the row is fetched first to know what the other half currently is.
    // The fetch doubles as the 404, which the accumulated UPDATE would
    // otherwise report anyway.
    const existing = await c.env.DB.prepare(
      'SELECT kind, category FROM transactions WHERE id = ? AND team_id = ?',
    )
      .bind(c.req.param('id'), teamId)
      .first<{ kind: TransactionKind; category: string }>();
    if (!existing) return c.json({ error: 'not_found' }, 404);

    const sets: string[] = [];
    const values: unknown[] = [];

    if (body.kind !== undefined || body.category !== undefined) {
      const kind = body.kind === undefined ? existing.kind : body.kind;
      if (!isTransactionKind(kind)) return c.json({ error: 'invalid_kind' }, 400);
      const category = body.category === undefined ? existing.category : body.category;
      if (!isCategoryForKind(kind, category)) {
        return c.json({ error: 'invalid_category' }, 400);
      }
      sets.push('kind = ?', 'category = ?');
      values.push(kind, category);
    }
    if (body.label !== undefined) {
      const label = optionalString(body.label, 200);
      if (!label) return c.json({ error: 'missing_label' }, 400);
      sets.push('label = ?');
      values.push(label);
    }
    if (body.note !== undefined) {
      sets.push('note = ?');
      values.push(optionalString(body.note, 1000));
    }
    if (body.amount_cents !== undefined) {
      const amount = boundedInt(body.amount_cents, 1, MAX_AMOUNT_CENTS);
      if (amount === null) return c.json({ error: 'invalid_amount' }, 400);
      sets.push('amount_cents = ?');
      values.push(amount);
    }
    if (body.occurred_at !== undefined) {
      const occurredAt = boundedInt(body.occurred_at, 0, MAX_EPOCH);
      if (occurredAt === null) return c.json({ error: 'invalid_occurred_at' }, 400);
      sets.push('occurred_at = ?');
      values.push(occurredAt);
    }
    if (body.fund_id !== undefined) {
      // Re-filing a line into another pot is the stated workflow for part
      // orders (which always book to the default) and for anything mis-filed.
      // An explicit null moves it back to unassigned.
      const fund = await resolveFundId(
        c.env.DB,
        teamId,
        body.fund_id as string | null,
      );
      if ('error' in fund) return c.json({ error: fund.error }, 400);
      sets.push('fund_id = ?');
      values.push(fund.fundId);
    }
    if (sets.length === 0) return c.json({ error: 'nothing_to_update' }, 400);

    sets.push('updated_at = ?');
    values.push(nowSeconds());

    await c.env.DB.prepare(
      `UPDATE transactions SET ${sets.join(', ')} WHERE id = ? AND team_id = ?`,
    )
      .bind(...values, c.req.param('id'), teamId)
      .run();

    const row = await c.env.DB.prepare(
      `SELECT ${TRANSACTION_COLUMNS} FROM transactions WHERE id = ? AND team_id = ?`,
    )
      .bind(c.req.param('id'), teamId)
      .first();
    return c.json({ transaction: row });
  },
);

/**
 * Delete a ledger line and its receipts together.
 *
 * D1 rows go in one batch — a line without its receipts or receipts without
 * their line are both states nobody should ever observe. R2 objects go after,
 * via waitUntil, mirroring deleteRosterPhoto's tolerance: a failed R2 delete
 * leaves an unreferenced object paying rent, not a dangling reference.
 *
 * An order that pointed at this line has its pointer cleared by the FK's SET
 * NULL, which deliberately reopens "mark ordered" — deleting the booked spend
 * says the booking was wrong, so the order goes back to being bookable.
 */
finance.delete(
  '/transactions/:id',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const { teamId } = authOf(c);
    const id = c.req.param('id');

    const { results: receipts } = await c.env.DB.prepare(
      `SELECT r2_key FROM media
        WHERE team_id = ? AND transaction_id = ? AND kind = 'receipt'`,
    )
      .bind(teamId, id)
      .all<{ r2_key: string }>();

    const [, deletion] = await c.env.DB.batch([
      c.env.DB.prepare(
        `DELETE FROM media
          WHERE team_id = ? AND transaction_id = ? AND kind = 'receipt'`,
      ).bind(teamId, id),
      c.env.DB.prepare(
        'DELETE FROM transactions WHERE id = ? AND team_id = ?',
      ).bind(id, teamId),
    ]);
    if (deletion.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

    for (const receipt of receipts) {
      c.executionCtx.waitUntil(
        c.env.MEDIA.delete(receipt.r2_key).catch(() => undefined),
      );
    }
    return c.json({ ok: true });
  },
);

// ------------------------------------------------------------------ receipts

/**
 * Attach a receipt. Same funnel as every other upload — sniff, strip, quota —
 * with the widened type list that admits PDF. See ingestImage and lib/images.
 */
finance.post(
  '/transactions/:id/receipts',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const { teamId, member } = authOf(c);

    const transaction = await c.env.DB.prepare(
      'SELECT id, season_id FROM transactions WHERE id = ? AND team_id = ?',
    )
      .bind(c.req.param('id'), teamId)
      .first<{ id: string; season_id: string }>();
    if (!transaction) return c.json({ error: 'not_found' }, 404);

    // Same double check as the media route: refuse an oversized upload from
    // its Content-Length before reading it, and again after, for a chunked
    // body that lied.
    const declared = Number(c.req.header('Content-Length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      return c.json({ error: 'file_too_large', max_bytes: MAX_BYTES }, 413);
    }

    const raw = new Uint8Array(await c.req.arrayBuffer());
    const result = await ingestImage(
      c.env,
      {
        teamId,
        // The receipt lives in the transaction's season, not necessarily the
        // current one — receipts get attached late, sometimes after rollover.
        seasonId: transaction.season_id,
        uploaderMemberId: member.id,
        kind: 'receipt',
        allowed: RECEIPT_TYPES,
        transactionId: transaction.id,
      },
      raw,
    );

    if ('error' in result) {
      return c.json(
        { error: result.error, max_bytes: MAX_BYTES, allowed: RECEIPT_TYPES },
        result.status,
      );
    }
    return c.json({ ...result, url: `/media/${result.id}` }, 201);
  },
);

finance.delete(
  '/transactions/:id/receipts/:mediaId',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const { teamId } = authOf(c);

    // Scoped to kind and transaction, so this route cannot be aimed at a photo
    // by guessing its id.
    const row = await c.env.DB.prepare(
      `SELECT id, r2_key FROM media
        WHERE id = ? AND team_id = ? AND transaction_id = ? AND kind = 'receipt'`,
    )
      .bind(c.req.param('mediaId'), teamId, c.req.param('id'))
      .first<{ id: string; r2_key: string }>();
    if (!row) return c.json({ error: 'not_found' }, 404);

    await c.env.MEDIA.delete(row.r2_key).catch(() => undefined);
    await c.env.DB.prepare('DELETE FROM media WHERE id = ? AND team_id = ?')
      .bind(row.id, teamId)
      .run();
    return c.json({ ok: true });
  },
);

// ------------------------------------------------------------------- summary

/**
 * The dashboard's four figures in one query pair. Zeros when there is no
 * current season — an empty ledger is a real answer, not an error.
 */
/**
 * Money that is about to disappear.
 *
 * Funds are TEAM-scoped, so this deliberately does not join the season the way
 * everything else in this route does — the fund is its own scope (see
 * migrations/0012_funds.sql). It is also why the block below is computed even
 * when the team has no current season: an expiring allocation does not care
 * whether the FTC season has been set up.
 *
 * Only pots that still have money in them and whose deadline is inside the
 * warning window. An array rather than one row because two grants can both be
 * closing, and a screen that mentions only the nearest would hide the other.
 */
const EXPIRING_FUNDS = `
  SELECT f.id AS id, f.name AS name, f.expires_at AS expires_at,
         COALESCE(SUM(CASE WHEN t.kind = 'income'  THEN t.amount_cents ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN t.kind = 'expense' THEN t.amount_cents ELSE 0 END), 0)
           AS remaining_cents
    FROM funds f
    LEFT JOIN transactions t ON t.fund_id = f.id AND t.team_id = f.team_id
   WHERE f.team_id = ?
     AND f.expires_at IS NOT NULL
     AND f.expires_at >= ?
     AND f.expires_at <= ?
   GROUP BY f.id
  HAVING remaining_cents > 0
   ORDER BY f.expires_at ASC`;

finance.get('/summary', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const now = nowSeconds();
  const season = await currentSeason(c, teamId);

  const expiringStatement = c.env.DB.prepare(EXPIRING_FUNDS).bind(
    teamId,
    now,
    now + EXPIRY_WARNING_SECONDS,
  );

  if (!season) {
    // No season means no ledger totals, but funds are team-scoped and an
    // expiring allocation is still worth shouting about.
    const expiring = await expiringStatement.all();
    return c.json({
      income_cents: 0,
      expense_cents: 0,
      opening_cents: 0,
      pending_orders: 0,
      pending_estimate_cents: 0,
      expiring: expiring.results,
    });
  }

  const [money, pending, expiring] = await c.env.DB.batch([
    c.env.DB.prepare(
      // `income_cents` EXCLUDES opening balances: "income" means what the team
      // raised this season, and counting a reserve it already had would
      // overstate that in the one figure a Sustain narrative quotes. The
      // reserve is not lost — it comes back as `opening_cents`, and BALANCE is
      // reassembled as opening + income - expense. See lib/finance.ts.
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'income' AND category <> ? THEN amount_cents ELSE 0 END), 0) AS income_cents,
         COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_cents ELSE 0 END), 0) AS expense_cents,
         COALESCE(SUM(CASE WHEN kind = 'income' AND category =  ? THEN amount_cents ELSE 0 END), 0) AS opening_cents
       FROM transactions WHERE team_id = ? AND season_id = ?`,
    ).bind(OPENING_BALANCE_CATEGORY, OPENING_BALANCE_CATEGORY, teamId, season.id),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS pending_orders,
              COALESCE(SUM(qty * unit_price_cents), 0) AS pending_estimate_cents
         FROM part_orders
        WHERE team_id = ? AND season_id = ? AND status = 'pending'`,
    ).bind(teamId, season.id),
    expiringStatement,
  ]);

  return c.json({
    ...(money.results[0] as Record<string, number>),
    ...(pending.results[0] as Record<string, number>),
    expiring: expiring.results,
  });
});

// -------------------------------------------------------------- part orders

/**
 * The queue, pending first. Requester and decider names are joined on rather
 * than fetched per row — same N+1 argument as the action-items rollup.
 */
finance.get('/orders', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const season = await currentSeason(c, teamId);
  if (!season) return c.json({ orders: [] });

  const { results } = await c.env.DB.prepare(
    `SELECT o.id AS id, o.item AS item, o.description AS description,
            o.url AS url, o.vendor AS vendor, o.qty AS qty,
            o.unit_price_cents AS unit_price_cents, o.status AS status,
            o.requested_by AS requested_by, o.decided_by AS decided_by,
            o.decided_at AS decided_at, o.decision_note AS decision_note,
            o.ordered_at AS ordered_at, o.received_at AS received_at,
            o.transaction_id AS transaction_id, o.created_at AS created_at,
            o.updated_at AS updated_at,
            r.display_name AS requested_by_name,
            d.display_name AS decided_by_name
       FROM part_orders o
       LEFT JOIN members r ON r.id = o.requested_by AND r.team_id = o.team_id
       LEFT JOIN members d ON d.id = o.decided_by AND d.team_id = o.team_id
      WHERE o.team_id = ? AND o.season_id = ?
      ORDER BY o.status = 'pending' DESC, o.created_at DESC
      LIMIT 300`,
  )
    .bind(teamId, season.id)
    .all();
  return c.json({ orders: results });
});

finance.post(
  '/orders',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);

    const item = optionalString(body.item, 200);
    if (!item) return c.json({ error: 'missing_item' }, 400);
    const qty = boundedInt(body.qty ?? 1, 1, 999);
    if (qty === null) return c.json({ error: 'invalid_qty' }, 400);
    // Required, unlike the note fields: an approver cannot decide "is this
    // worth it" about a blank, and asking the requester for a rough number is
    // exactly the discipline a budget teaches.
    const unitPrice = boundedInt(body.unit_price_cents, 1, MAX_AMOUNT_CENTS);
    if (unitPrice === null) return c.json({ error: 'invalid_price' }, 400);

    const url = optionalString(body.url, 500);
    if (url !== null) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return c.json({ error: 'invalid_url' }, 400);
      }
      // http(s) only: a javascript: URL here would hand every approver a link
      // that runs in their session the moment they click it.
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return c.json({ error: 'invalid_url' }, 400);
      }
    }

    const season = await currentSeason(c, teamId);
    if (!season) return c.json({ error: 'no_current_season' }, 409);

    const id = uuid();
    const now = nowSeconds();
    await c.env.DB.prepare(
      `INSERT INTO part_orders
         (id, team_id, season_id, item, description, url, vendor, qty,
          unit_price_cents, status, requested_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
      .bind(
        id,
        teamId,
        season.id,
        item,
        optionalString(body.description, 1000),
        url,
        optionalString(body.vendor, 120),
        qty,
        unitPrice,
        member.id,
        now,
        now,
      )
      .run();

    const row = await c.env.DB.prepare(
      `SELECT ${ORDER_COLUMNS} FROM part_orders WHERE id = ? AND team_id = ?`,
    )
      .bind(id, teamId)
      .first();
    return c.json({ order: row }, 201);
  },
);

/**
 * Edit a request while it is still a request.
 *
 * The requester may fix their own pending order (wrong quantity, better link)
 * and a coach or mentor may fix anybody's. Once a decision exists the row is
 * what was decided ON, and editing it would quietly change what an approver
 * signed off — hence the `status = 'pending'` guard in the UPDATE itself.
 */
finance.patch(
  '/orders/:id',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);

    const order = await c.env.DB.prepare(
      'SELECT id, status, requested_by FROM part_orders WHERE id = ? AND team_id = ?',
    )
      .bind(c.req.param('id'), teamId)
      .first<{ id: string; status: string; requested_by: string | null }>();
    if (!order) return c.json({ error: 'not_found' }, 404);

    const canManage = member.role === 'coach' || member.role === 'mentor';
    if (!canManage && order.requested_by !== member.id) {
      return c.json({ error: 'forbidden' }, 403);
    }
    if (order.status !== 'pending') return c.json({ error: 'invalid_state' }, 409);

    const sets: string[] = [];
    const values: unknown[] = [];

    if (body.item !== undefined) {
      const item = optionalString(body.item, 200);
      if (!item) return c.json({ error: 'missing_item' }, 400);
      sets.push('item = ?');
      values.push(item);
    }
    if (body.description !== undefined) {
      sets.push('description = ?');
      values.push(optionalString(body.description, 1000));
    }
    if (body.url !== undefined) {
      const url = optionalString(body.url, 500);
      if (url !== null) {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return c.json({ error: 'invalid_url' }, 400);
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return c.json({ error: 'invalid_url' }, 400);
        }
      }
      sets.push('url = ?');
      values.push(url);
    }
    if (body.vendor !== undefined) {
      sets.push('vendor = ?');
      values.push(optionalString(body.vendor, 120));
    }
    if (body.qty !== undefined) {
      const qty = boundedInt(body.qty, 1, 999);
      if (qty === null) return c.json({ error: 'invalid_qty' }, 400);
      sets.push('qty = ?');
      values.push(qty);
    }
    if (body.unit_price_cents !== undefined) {
      const unitPrice = boundedInt(body.unit_price_cents, 1, MAX_AMOUNT_CENTS);
      if (unitPrice === null) return c.json({ error: 'invalid_price' }, 400);
      sets.push('unit_price_cents = ?');
      values.push(unitPrice);
    }
    if (sets.length === 0) return c.json({ error: 'nothing_to_update' }, 400);

    sets.push('updated_at = ?');
    values.push(nowSeconds());

    // The guard again, in the write: the fetch above answered the permission
    // question, but between it and here another tab may have approved.
    const result = await c.env.DB.prepare(
      `UPDATE part_orders SET ${sets.join(', ')}
        WHERE id = ? AND team_id = ? AND status = 'pending'`,
    )
      .bind(...values, order.id, teamId)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'invalid_state' }, 409);

    const row = await c.env.DB.prepare(
      `SELECT ${ORDER_COLUMNS} FROM part_orders WHERE id = ? AND team_id = ?`,
    )
      .bind(order.id, teamId)
      .first();
    return c.json({ order: row });
  },
);

/** Approve or deny. The note is optional but is usually the denial reason. */
finance.post(
  '/orders/:id/decision',
  sameOriginOnly,
  requireMember,
  requireApprover,
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);

    if (body.decision !== 'approved' && body.decision !== 'denied') {
      return c.json({ error: 'invalid_decision' }, 400);
    }

    const order = await c.env.DB.prepare(
      'SELECT id, status FROM part_orders WHERE id = ? AND team_id = ?',
    )
      .bind(c.req.param('id'), teamId)
      .first<{ id: string; status: string }>();
    if (!order) return c.json({ error: 'not_found' }, 404);
    if (order.status !== 'pending') return c.json({ error: 'invalid_state' }, 409);

    const now = nowSeconds();
    const result = await c.env.DB.prepare(
      `UPDATE part_orders
          SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?,
              updated_at = ?
        WHERE id = ? AND team_id = ? AND status = 'pending'`,
    )
      .bind(
        body.decision,
        member.id,
        now,
        optionalString(body.note, 500),
        now,
        order.id,
        teamId,
      )
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'invalid_state' }, 409);

    const row = await c.env.DB.prepare(
      `SELECT ${ORDER_COLUMNS} FROM part_orders WHERE id = ? AND team_id = ?`,
    )
      .bind(order.id, teamId)
      .first();
    return c.json({ order: row });
  },
);

/**
 * The order was actually placed — book the spend.
 *
 * One batch: INSERT the expense line, then point the order at it behind `AND
 * transaction_id IS NULL`. A double press races to one booked line and one
 * 409, never two lines — the promote pattern from action items, doing money.
 *
 * The expense posts NOW, at ordering, not at receiving: the money is committed
 * the moment somebody checks out, and a spend-against-plan story counts
 * commitments. The booked amount is the estimate — a coach edits the ledger
 * line afterwards if shipping and tax moved it.
 */
finance.post(
  '/orders/:id/ordered',
  sameOriginOnly,
  requireMember,
  requireApprover,
  async (c) => {
    const { teamId, member } = authOf(c);

    const order = await c.env.DB.prepare(
      `SELECT id, season_id, item, vendor, qty, unit_price_cents, status,
              transaction_id
         FROM part_orders WHERE id = ? AND team_id = ?`,
    )
      .bind(c.req.param('id'), teamId)
      .first<{
        id: string;
        season_id: string;
        item: string;
        vendor: string | null;
        qty: number;
        unit_price_cents: number;
        status: string;
        transaction_id: string | null;
      }>();
    if (!order) return c.json({ error: 'not_found' }, 404);
    if (order.status !== 'approved' || order.transaction_id !== null) {
      return c.json({ error: 'invalid_state' }, 409);
    }

    const transactionId = uuid();
    const now = nowSeconds();
    const label =
      order.qty > 1 ? `${order.qty}× ${order.item}`.slice(0, 200) : order.item;
    // The order flow deliberately has no fund picker: an approver pressing
    // "mark ordered" in a pit is not the moment to ask which pot pays. It
    // books to the default and a coach re-files the line if it mattered.
    const fundId = await defaultFundId(c.env.DB, teamId);

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO transactions
           (id, team_id, season_id, kind, category, label, note, amount_cents,
            occurred_at, fund_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'expense', 'parts', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        transactionId,
        teamId,
        order.season_id,
        label,
        order.vendor ? `Ordered from ${order.vendor}` : null,
        order.qty * order.unit_price_cents,
        now,
        fundId,
        member.id,
        now,
        now,
      ),
      c.env.DB.prepare(
        `UPDATE part_orders
            SET status = 'ordered', transaction_id = ?, ordered_by = ?,
                ordered_at = ?, updated_at = ?
          WHERE id = ? AND team_id = ? AND status = 'approved'
            AND transaction_id IS NULL`,
      ).bind(transactionId, member.id, now, now, order.id, teamId),
    ]);

    // If the guarded UPDATE lost a race, the batch still inserted the
    // transaction — check the pointer and clean up rather than leaving an
    // orphan expense. This is the one place the batch cannot be fully atomic
    // for us, and the window is a double press, so the cleanup is cheap.
    const row = await c.env.DB.prepare(
      `SELECT ${ORDER_COLUMNS} FROM part_orders WHERE id = ? AND team_id = ?`,
    )
      .bind(order.id, teamId)
      .first<{ transaction_id: string | null }>();
    if (row?.transaction_id !== transactionId) {
      await c.env.DB.prepare(
        'DELETE FROM transactions WHERE id = ? AND team_id = ?',
      )
        .bind(transactionId, teamId)
        .run();
      return c.json({ error: 'invalid_state' }, 409);
    }

    return c.json({ order: row });
  },
);

finance.post(
  '/orders/:id/received',
  sameOriginOnly,
  requireMember,
  requireApprover,
  async (c) => {
    const { teamId, member } = authOf(c);
    const now = nowSeconds();

    const order = await c.env.DB.prepare(
      'SELECT id, status FROM part_orders WHERE id = ? AND team_id = ?',
    )
      .bind(c.req.param('id'), teamId)
      .first<{ id: string; status: string }>();
    if (!order) return c.json({ error: 'not_found' }, 404);
    if (order.status !== 'ordered') return c.json({ error: 'invalid_state' }, 409);

    const result = await c.env.DB.prepare(
      `UPDATE part_orders
          SET status = 'received', received_by = ?, received_at = ?, updated_at = ?
        WHERE id = ? AND team_id = ? AND status = 'ordered'`,
    )
      .bind(member.id, now, now, order.id, teamId)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'invalid_state' }, 409);

    const row = await c.env.DB.prepare(
      `SELECT ${ORDER_COLUMNS} FROM part_orders WHERE id = ? AND team_id = ?`,
    )
      .bind(order.id, teamId)
      .first();
    return c.json({ order: row });
  },
);

/**
 * Withdraw an order before money moves.
 *
 * The requester may pull their own PENDING request — changing your mind about
 * needing a part is not a decision anybody else owns. Coach or mentor may also
 * pull an APPROVED one (approved-but-not-ordered is still just intent).
 * Approvers who are neither get no special cancel reach: deciding somebody
 * else's request is theirs, unmaking their own team's plans is not.
 */
finance.post(
  '/orders/:id/cancel',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const { teamId, member } = authOf(c);

    const order = await c.env.DB.prepare(
      'SELECT id, status, requested_by FROM part_orders WHERE id = ? AND team_id = ?',
    )
      .bind(c.req.param('id'), teamId)
      .first<{ id: string; status: string; requested_by: string | null }>();
    if (!order) return c.json({ error: 'not_found' }, 404);

    const canManage = member.role === 'coach' || member.role === 'mentor';
    const own = order.requested_by === member.id;
    const allowedFrom = canManage
      ? ['pending', 'approved']
      : own
        ? ['pending']
        : [];
    if (!allowedFrom.includes(order.status)) {
      return c.json(
        { error: order.status === 'pending' || order.status === 'approved' ? 'forbidden' : 'invalid_state' },
        order.status === 'pending' || order.status === 'approved' ? 403 : 409,
      );
    }

    const now = nowSeconds();
    const result = await c.env.DB.prepare(
      `UPDATE part_orders SET status = 'canceled', updated_at = ?
        WHERE id = ? AND team_id = ? AND status IN ('pending', 'approved')
          AND (? OR (requested_by = ? AND status = 'pending'))`,
    )
      .bind(now, order.id, teamId, canManage ? 1 : 0, member.id)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'invalid_state' }, 409);

    const row = await c.env.DB.prepare(
      `SELECT ${ORDER_COLUMNS} FROM part_orders WHERE id = ? AND team_id = ?`,
    )
      .bind(order.id, teamId)
      .first();
    return c.json({ order: row });
  },
);

export { finance };
