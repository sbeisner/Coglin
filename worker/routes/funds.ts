/**
 * Funds: which pot the money came out of, and which pots are about to expire
 * (COG-0xx, finance phase 4).
 *
 * Mounted under `/api/finance` beside routes/finance.ts and routes/sponsorship.ts
 * rather than folded into either — finance.ts is already long, and the three
 * files declare disjoint paths, so the client keeps one finance surface. Same
 * call phase 2 made.
 *
 * WHO SEES: reads are plain `requireMember`, viewers included, exactly as the
 * ledger is. A parent or sponsor looking at "$340 of district money expires in
 * 41 days" is looking at the team's own stewardship, which is the thing they
 * are owed.
 *
 * WHO WRITES: `requireRole('coach','mentor')` throughout, unlike the
 * sponsorship pipeline where students own the work. Funds are the ledger's
 * STRUCTURE — where money lives and what it is allowed to do — and the ledger
 * is adult territory for the reasons routes/finance.ts gives. A student
 * re-filing which pot paid for a servo is not a student decision.
 *
 * NOTHING HERE EXPIRES ANYTHING. There is no cron and no status column. A fund
 * whose date has passed reads as expired because a predicate says so at read
 * time (`isExpired` in lib/funds.ts), not because a job wrote something. Same
 * discipline the newsletters route keeps about never claiming a send.
 */
import { Hono } from 'hono';
import { nowSeconds, uuid } from '../lib/crypto';
import { boundedInt, optionalString, readJson } from '../lib/http';
import { MAX_AMOUNT_CENTS, MAX_EPOCH, OPENING_BALANCE_CATEGORY } from '../lib/finance';
import { MAX_FUND_NAME, MAX_FUND_NOTE, MAX_FUNDS } from '../lib/funds';
import {
  auth as authOf,
  requireMember,
  requireRole,
  sameOriginOnly,
  type AppEnv,
} from '../lib/tenancy';

const funds = new Hono<AppEnv>();

const FUND_COLUMNS = `id, name, note, expires_at, is_default, created_by,
        created_at, updated_at`;

/**
 * A fund plus what is in it.
 *
 * Deliberately NOT season-filtered. The fund is the scope — next year's
 * allocation is a new fund row, not this one reset — so every transaction
 * pointing here counts, full stop. See migrations/0012_funds.sql.
 *
 * Ordered so the list reads the way a coach thinks: the default pot first,
 * then whatever expires soonest, then carryover pots by name.
 */
const FUND_AGGREGATE = `
  SELECT f.id AS id, f.name AS name, f.note AS note, f.expires_at AS expires_at,
         f.is_default AS is_default, f.created_by AS created_by,
         f.created_at AS created_at, f.updated_at AS updated_at,
         COALESCE(SUM(CASE WHEN t.kind = 'income'  THEN t.amount_cents ELSE 0 END), 0) AS income_cents,
         COALESCE(SUM(CASE WHEN t.kind = 'expense' THEN t.amount_cents ELSE 0 END), 0) AS expense_cents,
         COUNT(t.id) AS transaction_count
    FROM funds f
    LEFT JOIN transactions t ON t.fund_id = f.id AND t.team_id = f.team_id
   WHERE f.team_id = ?
   GROUP BY f.id
   ORDER BY f.is_default DESC,
            f.expires_at IS NULL ASC,
            f.expires_at ASC,
            f.name ASC`;

funds.get('/funds', requireMember, async (c) => {
  const { teamId } = authOf(c);

  const [rows, unassigned] = await c.env.DB.batch([
    c.env.DB.prepare(FUND_AGGREGATE).bind(teamId),
    // Money that predates funds, or that nobody has filed yet. A real state
    // rather than a missing value, so it gets a real row in the response and
    // the screen can show it without inventing a pseudo-fund server-side.
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'income'  THEN amount_cents ELSE 0 END), 0) AS income_cents,
              COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_cents ELSE 0 END), 0) AS expense_cents,
              COUNT(*) AS transaction_count
         FROM transactions WHERE team_id = ? AND fund_id IS NULL`,
    ).bind(teamId),
  ]);

  return c.json({
    funds: rows.results,
    unassigned: unassigned.results[0],
  });
});

funds.post(
  '/funds',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);

    const name = optionalString(body.name, MAX_FUND_NAME);
    if (!name) return c.json({ error: 'missing_name' }, 400);

    let expiresAt: number | null = null;
    if (body.expires_at !== undefined && body.expires_at !== null) {
      expiresAt = boundedInt(body.expires_at, 0, MAX_EPOCH);
      if (expiresAt === null) return c.json({ error: 'invalid_expires_at' }, 400);
    }

    const counted = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM funds WHERE team_id = ?',
    )
      .bind(teamId)
      .first<{ n: number }>();
    if ((counted?.n ?? 0) >= MAX_FUNDS) {
      return c.json({ error: 'too_many_funds', max: MAX_FUNDS }, 409);
    }

    // The first fund is the default whether or not anybody asked, because a
    // team with exactly one pot should never have to think about the concept.
    const isDefault = (counted?.n ?? 0) === 0 || body.is_default === true;

    const id = uuid();
    const now = nowSeconds();
    const statements = [
      c.env.DB.prepare(
        `INSERT INTO funds
           (id, team_id, name, note, expires_at, is_default, created_by,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        teamId,
        name,
        optionalString(body.note, MAX_FUND_NOTE),
        expiresAt,
        isDefault ? 1 : 0,
        member.id,
        now,
        now,
      ),
    ];
    if (isDefault) {
      // Clear first, then set — one default per team, the seasons.is_current
      // shape. Ordered so no window exists with two.
      statements.unshift(
        c.env.DB.prepare(
          'UPDATE funds SET is_default = 0, updated_at = ? WHERE team_id = ? AND is_default = 1',
        ).bind(now, teamId),
      );
    }
    await c.env.DB.batch(statements);

    const row = await c.env.DB.prepare(
      `SELECT ${FUND_COLUMNS} FROM funds WHERE id = ? AND team_id = ?`,
    )
      .bind(id, teamId)
      .first();
    return c.json(
      { fund: { ...row, income_cents: 0, expense_cents: 0, transaction_count: 0 } },
      201,
    );
  },
);

/**
 * Pre-initialise finance for a team that already has money.
 *
 * A team adopting Coglin in March holds a reserve and part of an allocation,
 * and must not have to back-enter a season of history to make the balances
 * right. This writes the pots AND their opening-balance ledger lines in one
 * batch, so the numbers are visible and explicable rather than appearing from
 * nowhere.
 *
 * ONE BATCH, not the client composing create-fund then create-transaction: a
 * half-failed setup would leave a pot whose balance is silently wrong, which
 * is worse than no setup at all.
 *
 * GUARDED. A second run would double every opening balance, so a team that
 * already has any fund gets a 409 and is sent to the ordinary create route.
 *
 * Declared before `/funds/:id` so "initialize" is never read as an id.
 */
funds.post(
  '/funds/initialize',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);

    const existing = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM funds WHERE team_id = ?',
    )
      .bind(teamId)
      .first<{ n: number }>();
    if ((existing?.n ?? 0) > 0) return c.json({ error: 'already_initialized' }, 409);

    // The opening lines are transactions, so they need a season to live in.
    const season = await c.env.DB.prepare(
      'SELECT id FROM seasons WHERE team_id = ? AND is_current = 1',
    )
      .bind(teamId)
      .first<{ id: string }>();
    if (!season) return c.json({ error: 'no_current_season' }, 409);

    let reserveCents: number | null = null;
    if (body.reserve_cents !== undefined && body.reserve_cents !== null) {
      reserveCents = boundedInt(body.reserve_cents, 1, MAX_AMOUNT_CENTS);
      if (reserveCents === null) return c.json({ error: 'invalid_amount' }, 400);
    }

    const incoming = Array.isArray(body.funds) ? body.funds : [];
    if (incoming.length + (reserveCents === null ? 0 : 1) === 0) {
      // Nothing to do is a mistake worth reporting: an empty initialise would
      // burn the one-shot guard and leave the team with no funds.
      return c.json({ error: 'nothing_to_initialize' }, 400);
    }
    if (incoming.length + 1 > MAX_FUNDS) {
      return c.json({ error: 'too_many_funds', max: MAX_FUNDS }, 409);
    }

    const now = nowSeconds();
    const statements: D1PreparedStatement[] = [];
    const created: { id: string; name: string }[] = [];

    /** One pot plus the line that says what was in it when we started. */
    const addFund = (
      name: string,
      amountCents: number | null,
      expiresAt: number | null,
      isDefault: boolean,
    ) => {
      const fundId = uuid();
      created.push({ id: fundId, name });
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO funds
             (id, team_id, name, note, expires_at, is_default, created_by,
              created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        ).bind(fundId, teamId, name, expiresAt, isDefault ? 1 : 0, member.id, now, now),
      );
      if (amountCents !== null) {
        statements.push(
          c.env.DB.prepare(
            `INSERT INTO transactions
               (id, team_id, season_id, kind, category, label, note, amount_cents,
                occurred_at, fund_id, created_by, created_at, updated_at)
             VALUES (?, ?, ?, 'income', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            uuid(),
            teamId,
            season.id,
            OPENING_BALANCE_CATEGORY,
            `${name} — opening balance`.slice(0, 200),
            'What was in this fund when the team started using Coglin.',
            amountCents,
            now,
            fundId,
            member.id,
            now,
            now,
          ),
        );
      }
    };

    // The reserve is the default pot: it carries over, so it is where money
    // with nowhere else to go belongs.
    if (reserveCents !== null) {
      const reserveName = optionalString(body.reserve_name, MAX_FUND_NAME) ?? 'Reserve';
      addFund(reserveName, reserveCents, null, true);
    }

    for (const [index, entry] of incoming.entries()) {
      if (!entry || typeof entry !== 'object') {
        return c.json({ error: 'invalid_body' }, 400);
      }
      const raw = entry as Record<string, unknown>;
      const name = optionalString(raw.name, MAX_FUND_NAME);
      if (!name) return c.json({ error: 'missing_name' }, 400);

      let amount: number | null = null;
      if (raw.amount_cents !== undefined && raw.amount_cents !== null) {
        amount = boundedInt(raw.amount_cents, 1, MAX_AMOUNT_CENTS);
        if (amount === null) return c.json({ error: 'invalid_amount' }, 400);
      }

      let expiresAt: number | null = null;
      if (raw.expires_at !== undefined && raw.expires_at !== null) {
        expiresAt = boundedInt(raw.expires_at, 0, MAX_EPOCH);
        if (expiresAt === null) return c.json({ error: 'invalid_expires_at' }, 400);
      }

      // Only the reserve is the default; if there is no reserve the first
      // listed pot takes it, so a team always has somewhere for stray money.
      addFund(name, amount, expiresAt, reserveCents === null && index === 0);
    }

    await c.env.DB.batch(statements);

    const rows = await c.env.DB.prepare(FUND_AGGREGATE).bind(teamId).all();
    return c.json({ funds: rows.results, created: created.length }, 201);
  },
);

funds.patch(
  '/funds/:id',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId } = authOf(c);

    const sets: string[] = [];
    const values: unknown[] = [];

    if (body.name !== undefined) {
      const name = optionalString(body.name, MAX_FUND_NAME);
      if (!name) return c.json({ error: 'missing_name' }, 400);
      // No snapshot anywhere, unlike sponsors.tier_name: a fund's name is its
      // label, not a promise fixed at a moment somebody agreed to it. Renaming
      // "District allocation" to "District allocation FY26" should read as the
      // same pot everywhere it appears, including on old lines.
      sets.push('name = ?');
      values.push(name);
    }
    if (body.note !== undefined) {
      sets.push('note = ?');
      values.push(optionalString(body.note, MAX_FUND_NOTE));
    }
    if (body.expires_at !== undefined) {
      if (body.expires_at === null) {
        // Converting use-or-lose into carryover. A real correction — somebody
        // mis-entered a deadline, or the district confirmed the money rolls.
        sets.push('expires_at = ?');
        values.push(null);
      } else {
        const expiresAt = boundedInt(body.expires_at, 0, MAX_EPOCH);
        if (expiresAt === null) return c.json({ error: 'invalid_expires_at' }, 400);
        sets.push('expires_at = ?');
        values.push(expiresAt);
      }
    }
    if (sets.length === 0) return c.json({ error: 'nothing_to_update' }, 400);

    sets.push('updated_at = ?');
    values.push(nowSeconds());

    const result = await c.env.DB.prepare(
      `UPDATE funds SET ${sets.join(', ')} WHERE id = ? AND team_id = ?`,
    )
      .bind(...values, c.req.param('id'), teamId)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

    const row = await c.env.DB.prepare(
      `SELECT ${FUND_COLUMNS} FROM funds WHERE id = ? AND team_id = ?`,
    )
      .bind(c.req.param('id'), teamId)
      .first();
    return c.json({ fund: row });
  },
);

funds.post(
  '/funds/:id/default',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const { teamId } = authOf(c);
    const id = c.req.param('id');

    const fund = await c.env.DB.prepare(
      'SELECT id FROM funds WHERE id = ? AND team_id = ?',
    )
      .bind(id, teamId)
      .first();
    if (!fund) return c.json({ error: 'not_found' }, 404);

    const now = nowSeconds();
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE funds SET is_default = 0, updated_at = ? WHERE team_id = ? AND is_default = 1',
      ).bind(now, teamId),
      c.env.DB.prepare(
        'UPDATE funds SET is_default = 1, updated_at = ? WHERE id = ? AND team_id = ?',
      ).bind(now, id, teamId),
    ]);

    const rows = await c.env.DB.prepare(FUND_AGGREGATE).bind(teamId).all();
    return c.json({ funds: rows.results });
  },
);

/**
 * Remove a pot.
 *
 * Refused while ledger lines still point at it. Which pot paid for something
 * is part of the money story, and orphaning those lines to "Unassigned" would
 * quietly erase it — so the coach re-files them first, deliberately. Same
 * shape as `campaign_in_use` and `sponsor_has_payments`.
 */
funds.delete(
  '/funds/:id',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const { teamId } = authOf(c);
    const id = c.req.param('id');

    const fund = await c.env.DB.prepare(
      'SELECT id FROM funds WHERE id = ? AND team_id = ?',
    )
      .bind(id, teamId)
      .first();
    if (!fund) return c.json({ error: 'not_found' }, 404);

    const used = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM transactions WHERE team_id = ? AND fund_id = ?',
    )
      .bind(teamId, id)
      .first<{ n: number }>();
    if ((used?.n ?? 0) > 0) {
      return c.json({ error: 'fund_in_use', transactions: used?.n ?? 0 }, 409);
    }

    await c.env.DB.prepare('DELETE FROM funds WHERE id = ? AND team_id = ?')
      .bind(id, teamId)
      .run();
    return c.json({ ok: true });
  },
);

export { funds };
