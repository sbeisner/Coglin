/**
 * Sponsorship campaigns: tiers, pitch copy, the prospect pipeline, and the
 * sponsors that come out of it (COG-0xx, finance phase 2).
 *
 * Mounted under `/api/finance` alongside routes/finance.ts rather than folded
 * into it — the ledger file is already long, and the two halves meet at exactly
 * one seam (recording a sponsor payment writes a `transactions` row). Same URL
 * prefix so the client keeps one finance section.
 *
 * WHO SEES: every GET here is plain `requireMember` — viewers included, the
 * same call the ledger makes. A viewer is a parent or a sponsor, and the
 * sponsorship story is the one part of the season most obviously theirs to
 * read.
 *
 * WHO WRITES:
 *   - Campaigns, tiers, pitch copy, prospects, commits, thank-yous:
 *     `denyRole('viewer')`. STUDENTS OWN THIS. Writing the pitch and working
 *     the pipeline is the business sub-team's actual job, and gating it to
 *     adults would make Coglin the place where a coach retypes what a student
 *     wrote. The collaboration-surface argument in lib/tenancy.ts applies
 *     directly.
 *   - Recording a payment: `requireRole('coach', 'mentor')`. That route writes
 *     a ledger line, and the ledger is coach territory (routes/finance.ts says
 *     why). A student marking a prospect committed records a PROMISE, which is
 *     theirs to record; a student recording that £500 arrived is bookkeeping.
 *
 * PLEDGED IS NOT PAID. `sponsors.amount_cents` is the promise;
 * `SUM(transactions.amount_cents WHERE sponsor_id = ...)` is what arrived. Two
 * different numbers, both shown, never merged. See 0010's header.
 *
 * CONTACT DETAILS: `sponsor_prospects.contact_*` hold an adult business
 * contact's name, email and phone. They are stored deliberately (0010 argues
 * it) and NOTHING IN THIS FILE MAY EVER LOG THEM — same discipline
 * worker/lib/email.ts applies to recipient addresses. If you add a
 * `console.error` here, check what is in scope first.
 */
import { Hono } from 'hono';
import { nowSeconds, uuid } from '../lib/crypto';
import { boundedInt, optionalString, readJson } from '../lib/http';
import { MAX_AMOUNT_CENTS, MAX_EPOCH } from '../lib/finance';
import { resolveFundId } from '../lib/funds';
import { emptyDoc, parseContent } from '../lib/notes';
import {
  isSettableStage,
  isWebUrl,
  looksLikeEmail,
  MAX_CAMPAIGNS,
  MAX_TIERS,
  SPONSOR_PAYMENT_CATEGORY,
  TIER_POSITION_GAP,
} from '../lib/sponsorship';
import {
  auth as authOf,
  denyRole,
  requireMember,
  requireRole,
  sameOriginOnly,
  type AppEnv,
} from '../lib/tenancy';

const sponsorship = new Hono<AppEnv>();

/** Without `pitch`, for the list. The body rides only the single-campaign GET. */
const CAMPAIGN_SUMMARY = `id, name, goal_cents, rev, created_by, updated_by,
        created_at, updated_at`;
const CAMPAIGN_FULL = `${CAMPAIGN_SUMMARY}, pitch, pitch_text`;

const TIER_COLUMNS = `id, campaign_id, name, amount_cents, benefits, position,
        created_at, updated_at`;

const PROSPECT_COLUMNS = `id, campaign_id, org_name, contact_name, contact_email,
        contact_phone, url, note, stage, pledged_cents, tier_id, source,
        stage_changed_by, stage_changed_at, sponsor_id, created_by, created_at,
        updated_at`;

const SPONSOR_COLUMNS = `id, campaign_id, name, tier_id, tier_name, amount_cents,
        thanked_at, thanked_by, created_by, created_at, updated_at`;

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

/** The campaign, or null when it is not this team's. Every :id route opens with it. */
async function ownedCampaign(
  c: { env: { DB: D1Database } },
  teamId: string,
  campaignId: string,
): Promise<{ id: string; season_id: string; rev: number; pitch: string } | null> {
  return c.env.DB.prepare(
    `SELECT id, season_id, rev, pitch FROM sponsorship_campaigns
      WHERE id = ? AND team_id = ?`,
  )
    .bind(campaignId, teamId)
    .first<{ id: string; season_id: string; rev: number; pitch: string }>();
}

/**
 * Validate the contact and link fields shared by prospect create and edit.
 *
 * Returns an error code or null. Kept in one place so the two routes cannot
 * drift on what an acceptable email or URL is.
 */
function validateProspectContact(body: Record<string, unknown>): string | null {
  if (body.contact_email !== undefined) {
    const email = optionalString(body.contact_email, 200);
    if (email !== null && !looksLikeEmail(email)) return 'invalid_email';
  }
  if (body.url !== undefined) {
    const url = optionalString(body.url, 500);
    if (url !== null && !isWebUrl(url)) return 'invalid_url';
  }
  return null;
}

// ------------------------------------------------------------------ campaigns

/**
 * The season's campaigns, each with its tiers and its money story.
 *
 * Three statements in one batch rather than a query per campaign: a team has at
 * most MAX_CAMPAIGNS of these and each needs tiers plus two rollups, so the
 * per-row version is the N+1 the candidates list avoids the same way.
 *
 * `pledged_cents` sums what sponsors promised. `raised_cents` sums what the
 * ledger says arrived, joined through the sponsor. They are deliberately
 * separate numbers — see 0010.
 */
sponsorship.get('/campaigns', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const season = await currentSeason(c, teamId);
  if (!season) return c.json({ campaigns: [] });

  const [campaigns, tiers, money, stages] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT ${CAMPAIGN_SUMMARY} FROM sponsorship_campaigns
        WHERE team_id = ? AND season_id = ?
        ORDER BY created_at ASC`,
    ).bind(teamId, season.id),
    c.env.DB.prepare(
      `SELECT ${TIER_COLUMNS} FROM sponsorship_tiers
        WHERE team_id = ? AND campaign_id IN (
          SELECT id FROM sponsorship_campaigns WHERE team_id = ? AND season_id = ?
        )
        ORDER BY position ASC`,
    ).bind(teamId, teamId, season.id),
    c.env.DB.prepare(
      `SELECT s.campaign_id AS campaign_id,
              COALESCE(SUM(s.amount_cents), 0) AS pledged_cents,
              COALESCE((
                SELECT SUM(t.amount_cents) FROM transactions t
                 WHERE t.team_id = s.team_id
                   AND t.sponsor_id IN (
                     SELECT id FROM sponsors s2
                      WHERE s2.team_id = s.team_id
                        AND s2.campaign_id = s.campaign_id
                   )
              ), 0) AS raised_cents,
              COUNT(*) AS sponsor_count
         FROM sponsors s
        WHERE s.team_id = ? AND s.season_id = ? AND s.campaign_id IS NOT NULL
        GROUP BY s.campaign_id`,
    ).bind(teamId, season.id),
    c.env.DB.prepare(
      `SELECT campaign_id, stage, COUNT(*) AS n
         FROM sponsor_prospects
        WHERE team_id = ? AND season_id = ?
        GROUP BY campaign_id, stage`,
    ).bind(teamId, season.id),
  ]);

  const tiersByCampaign = new Map<string, unknown[]>();
  for (const tier of tiers.results as { campaign_id: string }[]) {
    const list = tiersByCampaign.get(tier.campaign_id) ?? [];
    list.push(tier);
    tiersByCampaign.set(tier.campaign_id, list);
  }

  const moneyByCampaign = new Map<string, Record<string, number>>();
  for (const row of money.results as {
    campaign_id: string;
    pledged_cents: number;
    raised_cents: number;
    sponsor_count: number;
  }[]) {
    moneyByCampaign.set(row.campaign_id, {
      pledged_cents: row.pledged_cents,
      raised_cents: row.raised_cents,
      sponsor_count: row.sponsor_count,
    });
  }

  const stagesByCampaign = new Map<string, Record<string, number>>();
  for (const row of stages.results as {
    campaign_id: string;
    stage: string;
    n: number;
  }[]) {
    const counts = stagesByCampaign.get(row.campaign_id) ?? {};
    counts[row.stage] = row.n;
    stagesByCampaign.set(row.campaign_id, counts);
  }

  return c.json({
    campaigns: (campaigns.results as { id: string }[]).map((campaign) => ({
      ...campaign,
      tiers: tiersByCampaign.get(campaign.id) ?? [],
      pledged_cents: moneyByCampaign.get(campaign.id)?.pledged_cents ?? 0,
      raised_cents: moneyByCampaign.get(campaign.id)?.raised_cents ?? 0,
      sponsor_count: moneyByCampaign.get(campaign.id)?.sponsor_count ?? 0,
      stage_counts: stagesByCampaign.get(campaign.id) ?? {},
    })),
  });
});

/** One campaign including its pitch body — the editor's read. */
sponsorship.get('/campaigns/:id', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const row = await c.env.DB.prepare(
    `SELECT ${CAMPAIGN_FULL} FROM sponsorship_campaigns
      WHERE id = ? AND team_id = ?`,
  )
    .bind(c.req.param('id'), teamId)
    .first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ campaign: row });
});

sponsorship.post(
  '/campaigns',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);

    const name = optionalString(body.name, 200);
    if (!name) return c.json({ error: 'missing_name' }, 400);
    const goal = boundedInt(body.goal_cents, 1, MAX_AMOUNT_CENTS);
    if (goal === null) return c.json({ error: 'invalid_goal' }, 400);

    const season = await currentSeason(c, teamId);
    if (!season) return c.json({ error: 'no_current_season' }, 409);

    const existing = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM sponsorship_campaigns WHERE team_id = ? AND season_id = ?',
    )
      .bind(teamId, season.id)
      .first<{ n: number }>();
    if ((existing?.n ?? 0) >= MAX_CAMPAIGNS) {
      return c.json({ error: 'too_many_campaigns', max: MAX_CAMPAIGNS }, 409);
    }

    const id = uuid();
    const now = nowSeconds();
    await c.env.DB.prepare(
      `INSERT INTO sponsorship_campaigns
         (id, team_id, season_id, name, goal_cents, pitch, pitch_text, rev,
          created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '', 0, ?, ?, ?, ?)`,
    )
      .bind(id, teamId, season.id, name, goal, emptyDoc(), member.id, member.id, now, now)
      .run();

    const row = await c.env.DB.prepare(
      `SELECT ${CAMPAIGN_FULL} FROM sponsorship_campaigns WHERE id = ? AND team_id = ?`,
    )
      .bind(id, teamId)
      .first();
    return c.json(
      { campaign: { ...row, tiers: [], pledged_cents: 0, raised_cents: 0, sponsor_count: 0, stage_counts: {} } },
      201,
    );
  },
);

/**
 * Name and goal only. The pitch has its own route for the reason docs.ts
 * splits rename from content: one is a deliberate act, the other is a
 * keystroke path with a compare-and-swap on it.
 */
sponsorship.patch(
  '/campaigns/:id',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);

    const sets: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined) {
      const name = optionalString(body.name, 200);
      if (!name) return c.json({ error: 'missing_name' }, 400);
      sets.push('name = ?');
      values.push(name);
    }
    if (body.goal_cents !== undefined) {
      const goal = boundedInt(body.goal_cents, 1, MAX_AMOUNT_CENTS);
      if (goal === null) return c.json({ error: 'invalid_goal' }, 400);
      sets.push('goal_cents = ?');
      values.push(goal);
    }
    if (sets.length === 0) return c.json({ error: 'nothing_to_update' }, 400);

    sets.push('updated_by = ?', 'updated_at = ?');
    values.push(member.id, nowSeconds());

    const result = await c.env.DB.prepare(
      `UPDATE sponsorship_campaigns SET ${sets.join(', ')}
        WHERE id = ? AND team_id = ?`,
    )
      .bind(...values, c.req.param('id'), teamId)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

    const row = await c.env.DB.prepare(
      `SELECT ${CAMPAIGN_FULL} FROM sponsorship_campaigns WHERE id = ? AND team_id = ?`,
    )
      .bind(c.req.param('id'), teamId)
      .first();
    return c.json({ campaign: row });
  },
);

/**
 * The pitch, saved on a compare-and-swap.
 *
 * This is routes/docs.ts's content route applied to a second document type, and
 * deliberately identical in shape: `parseContent` decides what may be stored,
 * `base_rev` decides whether this writer still knows what they are overwriting,
 * and `AND rev = ?` on the UPDATE is why no transaction is needed. Two students
 * editing the pitch the night before a deadline is the case it exists for.
 *
 * `pitch` and `pitch_text` are written from ONE parse result — both or neither,
 * so the plain-text projection can never describe different content than the
 * body it came from.
 */
sponsorship.put(
  '/campaigns/:id/pitch',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);
    const campaignId = c.req.param('id');

    const parsed = parseContent(body.content);
    if ('error' in parsed) {
      // Malformed is the client's fault (400); too big or too many nodes is a
      // state the client can act on by trimming (409). Same split as docs.ts.
      const status = parsed.error === 'invalid_content' ? 400 : 409;
      return c.json({ error: parsed.error }, status);
    }
    const content = body.content as string;

    const current = await ownedCampaign(c, teamId, campaignId);
    if (!current) return c.json({ error: 'not_found' }, 404);

    const baseRev = typeof body.base_rev === 'number' ? body.base_rev : null;
    if (baseRev !== null && baseRev !== current.rev) {
      const server = await c.env.DB.prepare(
        `SELECT ${CAMPAIGN_FULL} FROM sponsorship_campaigns WHERE id = ? AND team_id = ?`,
      )
        .bind(campaignId, teamId)
        .first();
      return c.json({ error: 'stale_content', campaign: server }, 409);
    }

    // A no-op autosave writes zero rows. D1 bills per row.
    if (current.pitch === content) {
      const row = await c.env.DB.prepare(
        `SELECT ${CAMPAIGN_FULL} FROM sponsorship_campaigns WHERE id = ? AND team_id = ?`,
      )
        .bind(campaignId, teamId)
        .first();
      return c.json({ campaign: row, unchanged: true });
    }

    const now = nowSeconds();
    const result = await c.env.DB.prepare(
      `UPDATE sponsorship_campaigns
          SET pitch = ?, pitch_text = ?, rev = rev + 1, updated_by = ?, updated_at = ?
        WHERE id = ? AND team_id = ? AND rev = ?`,
    )
      .bind(content, parsed.text, member.id, now, campaignId, teamId, current.rev)
      .run();

    if (result.meta.changes === 0) {
      const server = await c.env.DB.prepare(
        `SELECT ${CAMPAIGN_FULL} FROM sponsorship_campaigns WHERE id = ? AND team_id = ?`,
      )
        .bind(campaignId, teamId)
        .first();
      if (!server) return c.json({ error: 'not_found' }, 404);
      return c.json({ error: 'stale_content', campaign: server }, 409);
    }

    const row = await c.env.DB.prepare(
      `SELECT ${CAMPAIGN_FULL} FROM sponsorship_campaigns WHERE id = ? AND team_id = ?`,
    )
      .bind(campaignId, teamId)
      .first();
    return c.json({ campaign: row });
  },
);

/**
 * Delete a campaign, but only an empty one.
 *
 * A campaign with prospects or sponsors attached is the record of a season's
 * fundraising, not clutter — so this refuses rather than cascading money
 * history away. Emptying it first is the deliberate act. Tiers DO cascade:
 * they are part of the campaign rather than history of their own.
 */
sponsorship.delete(
  '/campaigns/:id',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const { teamId } = authOf(c);
    const campaignId = c.req.param('id');

    const campaign = await ownedCampaign(c, teamId, campaignId);
    if (!campaign) return c.json({ error: 'not_found' }, 404);

    const [prospects, sponsors] = await c.env.DB.batch([
      c.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM sponsor_prospects WHERE team_id = ? AND campaign_id = ?',
      ).bind(teamId, campaignId),
      c.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM sponsors WHERE team_id = ? AND campaign_id = ?',
      ).bind(teamId, campaignId),
    ]);
    const prospectCount = (prospects.results[0] as { n: number }).n;
    const sponsorCount = (sponsors.results[0] as { n: number }).n;
    if (prospectCount > 0 || sponsorCount > 0) {
      return c.json(
        {
          error: 'campaign_in_use',
          prospects: prospectCount,
          sponsors: sponsorCount,
        },
        409,
      );
    }

    await c.env.DB.prepare(
      'DELETE FROM sponsorship_campaigns WHERE id = ? AND team_id = ?',
    )
      .bind(campaignId, teamId)
      .run();
    return c.json({ ok: true });
  },
);

// ---------------------------------------------------------------------- tiers

sponsorship.post(
  '/campaigns/:id/tiers',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId } = authOf(c);
    const campaignId = c.req.param('id');

    const campaign = await ownedCampaign(c, teamId, campaignId);
    if (!campaign) return c.json({ error: 'not_found' }, 404);

    const name = optionalString(body.name, 100);
    if (!name) return c.json({ error: 'missing_name' }, 400);
    const amount = boundedInt(body.amount_cents, 1, MAX_AMOUNT_CENTS);
    if (amount === null) return c.json({ error: 'invalid_amount' }, 400);

    const counted = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS max
         FROM sponsorship_tiers WHERE team_id = ? AND campaign_id = ?`,
    )
      .bind(teamId, campaignId)
      .first<{ n: number; max: number }>();
    if ((counted?.n ?? 0) >= MAX_TIERS) {
      return c.json({ error: 'too_many_tiers', max: MAX_TIERS }, 409);
    }

    const id = uuid();
    const now = nowSeconds();
    await c.env.DB.prepare(
      `INSERT INTO sponsorship_tiers
         (id, team_id, campaign_id, name, amount_cents, benefits, position,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        teamId,
        campaignId,
        name,
        amount,
        optionalString(body.benefits, 500),
        (counted?.max ?? 0) + TIER_POSITION_GAP,
        now,
        now,
      )
      .run();

    const row = await c.env.DB.prepare(
      `SELECT ${TIER_COLUMNS} FROM sponsorship_tiers WHERE id = ? AND team_id = ?`,
    )
      .bind(id, teamId)
      .first();
    return c.json({ tier: row }, 201);
  },
);

/**
 * Reorder every tier in one write.
 *
 * Takes the full id list rather than a moved-id plus a target, and refuses
 * anything that is not an exact permutation of what the campaign currently
 * holds (`stale_order`). A partial list would silently strand the tiers it
 * omitted at their old positions, interleaved with the new ones — which reads
 * as a shuffle nobody asked for. Declared before the `:tierId` routes so
 * `/order` is not parsed as a tier id.
 */
sponsorship.put(
  '/campaigns/:id/tiers/order',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body || !Array.isArray(body.ids)) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const { teamId } = authOf(c);
    const campaignId = c.req.param('id');

    const campaign = await ownedCampaign(c, teamId, campaignId);
    if (!campaign) return c.json({ error: 'not_found' }, 404);

    const { results } = await c.env.DB.prepare(
      'SELECT id FROM sponsorship_tiers WHERE team_id = ? AND campaign_id = ?',
    )
      .bind(teamId, campaignId)
      .all<{ id: string }>();

    const current = new Set(results.map((r) => r.id));
    const wanted = body.ids as unknown[];
    const seen = new Set<string>();
    for (const entry of wanted) {
      if (typeof entry !== 'string' || !current.has(entry) || seen.has(entry)) {
        return c.json({ error: 'stale_order' }, 409);
      }
      seen.add(entry);
    }
    if (seen.size !== current.size) return c.json({ error: 'stale_order' }, 409);

    const now = nowSeconds();
    await c.env.DB.batch(
      (wanted as string[]).map((id, index) =>
        c.env.DB.prepare(
          `UPDATE sponsorship_tiers SET position = ?, updated_at = ?
            WHERE id = ? AND team_id = ? AND campaign_id = ?`,
        ).bind((index + 1) * TIER_POSITION_GAP, now, id, teamId, campaignId),
      ),
    );

    const fresh = await c.env.DB.prepare(
      `SELECT ${TIER_COLUMNS} FROM sponsorship_tiers
        WHERE team_id = ? AND campaign_id = ? ORDER BY position ASC`,
    )
      .bind(teamId, campaignId)
      .all();
    return c.json({ tiers: fresh.results });
  },
);

sponsorship.patch(
  '/campaigns/:id/tiers/:tierId',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId } = authOf(c);

    const sets: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined) {
      const name = optionalString(body.name, 100);
      if (!name) return c.json({ error: 'missing_name' }, 400);
      sets.push('name = ?');
      values.push(name);
    }
    if (body.amount_cents !== undefined) {
      const amount = boundedInt(body.amount_cents, 1, MAX_AMOUNT_CENTS);
      if (amount === null) return c.json({ error: 'invalid_amount' }, 400);
      sets.push('amount_cents = ?');
      values.push(amount);
    }
    if (body.benefits !== undefined) {
      sets.push('benefits = ?');
      values.push(optionalString(body.benefits, 500));
    }
    if (sets.length === 0) return c.json({ error: 'nothing_to_update' }, 400);

    sets.push('updated_at = ?');
    values.push(nowSeconds());

    // Scoped to the campaign as well as the team, so this route cannot be
    // aimed at another campaign's tier by guessing an id.
    const result = await c.env.DB.prepare(
      `UPDATE sponsorship_tiers SET ${sets.join(', ')}
        WHERE id = ? AND team_id = ? AND campaign_id = ?`,
    )
      .bind(...values, c.req.param('tierId'), teamId, c.req.param('id'))
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

    const row = await c.env.DB.prepare(
      `SELECT ${TIER_COLUMNS} FROM sponsorship_tiers WHERE id = ? AND team_id = ?`,
    )
      .bind(c.req.param('tierId'), teamId)
      .first();
    return c.json({ tier: row });
  },
);

/**
 * Delete a tier. Free, deliberately: a sponsor who bought it keeps
 * `tier_name` as a snapshot (0010), so deleting the tier cannot rewrite what
 * they were promised. Prospects pointing at it fall back to no tier.
 */
sponsorship.delete(
  '/campaigns/:id/tiers/:tierId',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const { teamId } = authOf(c);
    const result = await c.env.DB.prepare(
      'DELETE FROM sponsorship_tiers WHERE id = ? AND team_id = ? AND campaign_id = ?',
    )
      .bind(c.req.param('tierId'), teamId, c.req.param('id'))
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true });
  },
);

// ------------------------------------------------------------------ prospects

sponsorship.get('/campaigns/:id/prospects', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const campaignId = c.req.param('id');

  const campaign = await ownedCampaign(c, teamId, campaignId);
  if (!campaign) return c.json({ error: 'not_found' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT p.id AS id, p.campaign_id AS campaign_id, p.org_name AS org_name,
            p.contact_name AS contact_name, p.contact_email AS contact_email,
            p.contact_phone AS contact_phone, p.url AS url, p.note AS note,
            p.stage AS stage, p.pledged_cents AS pledged_cents,
            p.tier_id AS tier_id, p.source AS source,
            p.stage_changed_by AS stage_changed_by,
            p.stage_changed_at AS stage_changed_at, p.sponsor_id AS sponsor_id,
            p.created_by AS created_by, p.created_at AS created_at,
            p.updated_at AS updated_at,
            m.display_name AS stage_changed_by_name,
            t.name AS tier_name
       FROM sponsor_prospects p
       LEFT JOIN members m ON m.id = p.stage_changed_by AND m.team_id = p.team_id
       LEFT JOIN sponsorship_tiers t ON t.id = p.tier_id AND t.team_id = p.team_id
      WHERE p.team_id = ? AND p.campaign_id = ?
      ORDER BY p.created_at DESC
      LIMIT 300`,
  )
    .bind(teamId, campaignId)
    .all();
  return c.json({ prospects: results });
});

sponsorship.post(
  '/campaigns/:id/prospects',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);
    const campaignId = c.req.param('id');

    const campaign = await ownedCampaign(c, teamId, campaignId);
    if (!campaign) return c.json({ error: 'not_found' }, 404);

    const orgName = optionalString(body.org_name, 200);
    if (!orgName) return c.json({ error: 'missing_org_name' }, 400);

    const contactError = validateProspectContact(body);
    if (contactError) return c.json({ error: contactError }, 400);

    let pledged: number | null = null;
    if (body.pledged_cents !== undefined && body.pledged_cents !== null) {
      pledged = boundedInt(body.pledged_cents, 1, MAX_AMOUNT_CENTS);
      if (pledged === null) return c.json({ error: 'invalid_amount' }, 400);
    }

    const tierId = optionalString(body.tier_id, 64);
    if (tierId) {
      const tier = await c.env.DB.prepare(
        'SELECT id FROM sponsorship_tiers WHERE id = ? AND team_id = ? AND campaign_id = ?',
      )
        .bind(tierId, teamId, campaignId)
        .first();
      if (!tier) return c.json({ error: 'invalid_tier' }, 400);
    }

    const stage = body.stage === undefined ? 'researching' : body.stage;
    if (!isSettableStage(stage)) return c.json({ error: 'invalid_stage' }, 400);

    const id = uuid();
    const now = nowSeconds();
    await c.env.DB.prepare(
      `INSERT INTO sponsor_prospects
         (id, team_id, season_id, campaign_id, org_name, contact_name,
          contact_email, contact_phone, url, note, stage, pledged_cents,
          tier_id, source, stage_changed_by, stage_changed_at, created_by,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        teamId,
        // The campaign's season, not the current one — the same argument the
        // receipt route makes about attaching to the row's own season.
        campaign.season_id,
        campaignId,
        orgName,
        optionalString(body.contact_name, 120),
        optionalString(body.contact_email, 200),
        optionalString(body.contact_phone, 40),
        optionalString(body.url, 500),
        optionalString(body.note, 1000),
        stage,
        pledged,
        tierId,
        // `source` is hardcoded 'manual' above: a client cannot claim the model
        // found this row.
        member.id,
        now,
        member.id,
        now,
        now,
      )
      .run();

    const row = await c.env.DB.prepare(
      `SELECT ${PROSPECT_COLUMNS} FROM sponsor_prospects WHERE id = ? AND team_id = ?`,
    )
      .bind(id, teamId)
      .first();
    return c.json({ prospect: row }, 201);
  },
);

/**
 * Edit a prospect, including moving it along the pipeline.
 *
 * `stage` accepts every stage EXCEPT 'committed' — committing creates a sponsor
 * record, so it has its own route and its own guard. A prospect that has
 * already been committed is frozen here entirely: its sponsor row carries the
 * money, and quietly editing the org name or walking the stage backwards would
 * leave the two disagreeing. Undo means deleting the sponsor.
 */
sponsorship.patch(
  '/prospects/:id',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);
    const prospectId = c.req.param('id');

    const existing = await c.env.DB.prepare(
      `SELECT id, campaign_id, sponsor_id FROM sponsor_prospects
        WHERE id = ? AND team_id = ?`,
    )
      .bind(prospectId, teamId)
      .first<{ id: string; campaign_id: string; sponsor_id: string | null }>();
    if (!existing) return c.json({ error: 'not_found' }, 404);
    if (existing.sponsor_id !== null) {
      return c.json({ error: 'already_committed', sponsor_id: existing.sponsor_id }, 409);
    }

    const contactError = validateProspectContact(body);
    if (contactError) return c.json({ error: contactError }, 400);

    const sets: string[] = [];
    const values: unknown[] = [];

    if (body.org_name !== undefined) {
      const orgName = optionalString(body.org_name, 200);
      if (!orgName) return c.json({ error: 'missing_org_name' }, 400);
      sets.push('org_name = ?');
      values.push(orgName);
    }
    for (const [key, max] of [
      ['contact_name', 120],
      ['contact_email', 200],
      ['contact_phone', 40],
      ['url', 500],
      ['note', 1000],
    ] as const) {
      if (body[key] !== undefined) {
        sets.push(`${key} = ?`);
        values.push(optionalString(body[key], max));
      }
    }
    if (body.pledged_cents !== undefined) {
      if (body.pledged_cents === null) {
        sets.push('pledged_cents = ?');
        values.push(null);
      } else {
        const pledged = boundedInt(body.pledged_cents, 1, MAX_AMOUNT_CENTS);
        if (pledged === null) return c.json({ error: 'invalid_amount' }, 400);
        sets.push('pledged_cents = ?');
        values.push(pledged);
      }
    }
    if (body.tier_id !== undefined) {
      const tierId = optionalString(body.tier_id, 64);
      if (tierId) {
        const tier = await c.env.DB.prepare(
          'SELECT id FROM sponsorship_tiers WHERE id = ? AND team_id = ? AND campaign_id = ?',
        )
          .bind(tierId, teamId, existing.campaign_id)
          .first();
        if (!tier) return c.json({ error: 'invalid_tier' }, 400);
      }
      sets.push('tier_id = ?');
      values.push(tierId);
    }
    if (body.stage !== undefined) {
      if (!isSettableStage(body.stage)) return c.json({ error: 'invalid_stage' }, 400);
      sets.push('stage = ?', 'stage_changed_by = ?', 'stage_changed_at = ?');
      values.push(body.stage, member.id, nowSeconds());
    }
    if (sets.length === 0) return c.json({ error: 'nothing_to_update' }, 400);

    sets.push('updated_at = ?');
    values.push(nowSeconds());

    const result = await c.env.DB.prepare(
      `UPDATE sponsor_prospects SET ${sets.join(', ')}
        WHERE id = ? AND team_id = ? AND sponsor_id IS NULL`,
    )
      .bind(...values, prospectId, teamId)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'already_committed' }, 409);

    const row = await c.env.DB.prepare(
      `SELECT ${PROSPECT_COLUMNS} FROM sponsor_prospects WHERE id = ? AND team_id = ?`,
    )
      .bind(prospectId, teamId)
      .first();
    return c.json({ prospect: row });
  },
);

/**
 * They said yes: promote the prospect into a sponsor.
 *
 * The promote pattern, third instance (action item → task, part order →
 * transaction, prospect → sponsor). One batch inserts the sponsor and points
 * the prospect at it behind `AND sponsor_id IS NULL`, so two students pressing
 * Commit at once produce one sponsor and one 409 rather than two sponsors and a
 * confusing pledge total.
 *
 * The amount falls back: what the dialog sent, else what the prospect pledged,
 * else what their tier costs. A sponsor with no amount would break every
 * pledged-vs-paid read on the screen, so a missing one is a 400 rather than a
 * zero.
 *
 * Recording that the money ARRIVED is a separate, coach-only act — see
 * POST /sponsors/:id/payments. Committing records a promise.
 */
sponsorship.post(
  '/prospects/:id/commit',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = (await readJson(c)) ?? {};
    const { teamId, member } = authOf(c);
    const prospectId = c.req.param('id');

    const prospect = await c.env.DB.prepare(
      `SELECT p.id AS id, p.season_id AS season_id, p.campaign_id AS campaign_id,
              p.org_name AS org_name, p.pledged_cents AS pledged_cents,
              p.tier_id AS tier_id, p.sponsor_id AS sponsor_id,
              t.name AS tier_name, t.amount_cents AS tier_amount
         FROM sponsor_prospects p
         LEFT JOIN sponsorship_tiers t ON t.id = p.tier_id AND t.team_id = p.team_id
        WHERE p.id = ? AND p.team_id = ?`,
    )
      .bind(prospectId, teamId)
      .first<{
        id: string;
        season_id: string;
        campaign_id: string;
        org_name: string;
        pledged_cents: number | null;
        tier_id: string | null;
        sponsor_id: string | null;
        tier_name: string | null;
        tier_amount: number | null;
      }>();
    if (!prospect) return c.json({ error: 'not_found' }, 404);
    if (prospect.sponsor_id !== null) {
      return c.json({ error: 'already_committed', sponsor_id: prospect.sponsor_id }, 409);
    }

    let amount: number | null = null;
    if (body.amount_cents !== undefined && body.amount_cents !== null) {
      amount = boundedInt(body.amount_cents, 1, MAX_AMOUNT_CENTS);
      if (amount === null) return c.json({ error: 'invalid_amount' }, 400);
    } else {
      amount = prospect.pledged_cents ?? prospect.tier_amount ?? null;
    }
    if (amount === null) return c.json({ error: 'missing_amount' }, 400);

    const name = optionalString(body.name, 200) ?? prospect.org_name;
    const sponsorId = uuid();
    const now = nowSeconds();

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO sponsors
           (id, team_id, season_id, campaign_id, name, tier_id, tier_name,
            amount_cents, thanked_at, thanked_by, created_by, created_at,
            updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
      ).bind(
        sponsorId,
        teamId,
        prospect.season_id,
        prospect.campaign_id,
        name,
        prospect.tier_id,
        // The snapshot. What they were promised, frozen at the moment they
        // agreed to it — see 0010.
        prospect.tier_name,
        amount,
        member.id,
        now,
        now,
      ),
      c.env.DB.prepare(
        `UPDATE sponsor_prospects
            SET stage = 'committed', sponsor_id = ?, stage_changed_by = ?,
                stage_changed_at = ?, updated_at = ?
          WHERE id = ? AND team_id = ? AND sponsor_id IS NULL`,
      ).bind(sponsorId, member.id, now, now, prospectId, teamId),
    ]);

    // The batch is not atomic for us across both statements, so confirm the
    // pointer is ours and clean up the sponsor if we lost the race. Same
    // post-check the part-order mark-ordered route makes, for the same reason.
    const row = await c.env.DB.prepare(
      `SELECT ${PROSPECT_COLUMNS} FROM sponsor_prospects WHERE id = ? AND team_id = ?`,
    )
      .bind(prospectId, teamId)
      .first<{ sponsor_id: string | null }>();
    if (row?.sponsor_id !== sponsorId) {
      await c.env.DB.prepare('DELETE FROM sponsors WHERE id = ? AND team_id = ?')
        .bind(sponsorId, teamId)
        .run();
      return c.json({ error: 'already_committed' }, 409);
    }

    const sponsor = await c.env.DB.prepare(
      `SELECT ${SPONSOR_COLUMNS} FROM sponsors WHERE id = ? AND team_id = ?`,
    )
      .bind(sponsorId, teamId)
      .first();
    return c.json({ prospect: row, sponsor }, 201);
  },
);

sponsorship.delete(
  '/prospects/:id',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const { teamId } = authOf(c);
    const prospectId = c.req.param('id');

    const prospect = await c.env.DB.prepare(
      'SELECT id, sponsor_id FROM sponsor_prospects WHERE id = ? AND team_id = ?',
    )
      .bind(prospectId, teamId)
      .first<{ id: string; sponsor_id: string | null }>();
    if (!prospect) return c.json({ error: 'not_found' }, 404);
    // Deleting a committed prospect would sever the sponsor's provenance —
    // where that money came from is part of the money story. Delete the sponsor
    // first if this is a genuine undo.
    if (prospect.sponsor_id !== null) {
      return c.json({ error: 'already_committed', sponsor_id: prospect.sponsor_id }, 409);
    }

    await c.env.DB.prepare(
      'DELETE FROM sponsor_prospects WHERE id = ? AND team_id = ?',
    )
      .bind(prospectId, teamId)
      .run();
    return c.json({ ok: true });
  },
);

// -------------------------------------------------------------------- sponsors

/**
 * Everyone who said yes this season, with pledged and paid side by side.
 *
 * `paid_cents` comes from a grouped query over the ledger rather than a column,
 * because a sponsor may pay in instalments and a stored total would be a second
 * copy of the truth waiting to drift from the transactions it sums.
 */
sponsorship.get('/sponsors', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const season = await currentSeason(c, teamId);
  if (!season) return c.json({ sponsors: [] });

  const [sponsors, payments] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT s.id AS id, s.campaign_id AS campaign_id, s.name AS name,
              s.tier_id AS tier_id, s.tier_name AS tier_name,
              s.amount_cents AS amount_cents, s.thanked_at AS thanked_at,
              s.thanked_by AS thanked_by, s.created_by AS created_by,
              s.created_at AS created_at, s.updated_at AS updated_at,
              m.display_name AS thanked_by_name,
              c.name AS campaign_name,
              p.id AS prospect_id
         FROM sponsors s
         LEFT JOIN members m ON m.id = s.thanked_by AND m.team_id = s.team_id
         LEFT JOIN sponsorship_campaigns c
           ON c.id = s.campaign_id AND c.team_id = s.team_id
         LEFT JOIN sponsor_prospects p
           ON p.sponsor_id = s.id AND p.team_id = s.team_id
        WHERE s.team_id = ? AND s.season_id = ?
        ORDER BY s.amount_cents DESC, s.created_at DESC
        LIMIT 300`,
    ).bind(teamId, season.id),
    c.env.DB.prepare(
      `SELECT sponsor_id, COALESCE(SUM(amount_cents), 0) AS paid_cents,
              COUNT(*) AS payment_count
         FROM transactions
        WHERE team_id = ? AND sponsor_id IS NOT NULL
        GROUP BY sponsor_id`,
    ).bind(teamId),
  ]);

  const paidBySponsor = new Map<string, { paid_cents: number; payment_count: number }>();
  for (const row of payments.results as {
    sponsor_id: string;
    paid_cents: number;
    payment_count: number;
  }[]) {
    paidBySponsor.set(row.sponsor_id, {
      paid_cents: row.paid_cents,
      payment_count: row.payment_count,
    });
  }

  return c.json({
    sponsors: (sponsors.results as { id: string }[]).map((sponsor) => ({
      ...sponsor,
      paid_cents: paidBySponsor.get(sponsor.id)?.paid_cents ?? 0,
      payment_count: paidBySponsor.get(sponsor.id)?.payment_count ?? 0,
    })),
  });
});

/**
 * A sponsor who was never in the pipeline — a cheque that simply arrived, which
 * is how a returning sponsor usually behaves.
 */
sponsorship.post(
  '/sponsors',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);

    const name = optionalString(body.name, 200);
    if (!name) return c.json({ error: 'missing_name' }, 400);
    const amount = boundedInt(body.amount_cents, 1, MAX_AMOUNT_CENTS);
    if (amount === null) return c.json({ error: 'invalid_amount' }, 400);

    const season = await currentSeason(c, teamId);
    if (!season) return c.json({ error: 'no_current_season' }, 409);

    const campaignId = optionalString(body.campaign_id, 64);
    if (campaignId) {
      const campaign = await ownedCampaign(c, teamId, campaignId);
      if (!campaign) return c.json({ error: 'invalid_campaign' }, 400);
    }

    let tierName: string | null = null;
    const tierId = optionalString(body.tier_id, 64);
    if (tierId) {
      const tier = await c.env.DB.prepare(
        `SELECT name FROM sponsorship_tiers
          WHERE id = ? AND team_id = ? AND (? IS NULL OR campaign_id = ?)`,
      )
        .bind(tierId, teamId, campaignId, campaignId)
        .first<{ name: string }>();
      if (!tier) return c.json({ error: 'invalid_tier' }, 400);
      tierName = tier.name;
    }

    const id = uuid();
    const now = nowSeconds();
    await c.env.DB.prepare(
      `INSERT INTO sponsors
         (id, team_id, season_id, campaign_id, name, tier_id, tier_name,
          amount_cents, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        teamId,
        season.id,
        campaignId,
        name,
        tierId,
        tierName,
        amount,
        member.id,
        now,
        now,
      )
      .run();

    const row = await c.env.DB.prepare(
      `SELECT ${SPONSOR_COLUMNS} FROM sponsors WHERE id = ? AND team_id = ?`,
    )
      .bind(id, teamId)
      .first();
    return c.json({ sponsor: { ...row, paid_cents: 0, payment_count: 0 } }, 201);
  },
);

sponsorship.patch(
  '/sponsors/:id',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId } = authOf(c);
    const sponsorId = c.req.param('id');

    const existing = await c.env.DB.prepare(
      'SELECT id, campaign_id FROM sponsors WHERE id = ? AND team_id = ?',
    )
      .bind(sponsorId, teamId)
      .first<{ id: string; campaign_id: string | null }>();
    if (!existing) return c.json({ error: 'not_found' }, 404);

    const sets: string[] = [];
    const values: unknown[] = [];

    if (body.name !== undefined) {
      const name = optionalString(body.name, 200);
      if (!name) return c.json({ error: 'missing_name' }, 400);
      sets.push('name = ?');
      values.push(name);
    }
    if (body.amount_cents !== undefined) {
      const amount = boundedInt(body.amount_cents, 1, MAX_AMOUNT_CENTS);
      if (amount === null) return c.json({ error: 'invalid_amount' }, 400);
      sets.push('amount_cents = ?');
      values.push(amount);
    }
    if (body.tier_id !== undefined) {
      const tierId = optionalString(body.tier_id, 64);
      if (tierId) {
        const tier = await c.env.DB.prepare(
          'SELECT name FROM sponsorship_tiers WHERE id = ? AND team_id = ?',
        )
          .bind(tierId, teamId)
          .first<{ name: string }>();
        if (!tier) return c.json({ error: 'invalid_tier' }, 400);
        // Re-snapshot: changing the tier changes what they are down as buying.
        sets.push('tier_id = ?', 'tier_name = ?');
        values.push(tierId, tier.name);
      } else {
        sets.push('tier_id = ?', 'tier_name = ?');
        values.push(null, null);
      }
    }
    if (sets.length === 0) return c.json({ error: 'nothing_to_update' }, 400);

    sets.push('updated_at = ?');
    values.push(nowSeconds());

    await c.env.DB.prepare(
      `UPDATE sponsors SET ${sets.join(', ')} WHERE id = ? AND team_id = ?`,
    )
      .bind(...values, sponsorId, teamId)
      .run();

    const row = await c.env.DB.prepare(
      `SELECT ${SPONSOR_COLUMNS} FROM sponsors WHERE id = ? AND team_id = ?`,
    )
      .bind(sponsorId, teamId)
      .first();
    return c.json({ sponsor: row });
  },
);

/**
 * Mark a sponsor thanked, or un-mark them.
 *
 * Un-marking exists because the button is small and a phone in a pit is not a
 * precise instrument. The stamp records who and when, which is the part a
 * Sustain narrative can actually use.
 */
sponsorship.post(
  '/sponsors/:id/thanked',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = (await readJson(c)) ?? {};
    if (typeof body.thanked !== 'boolean') {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const { teamId, member } = authOf(c);
    const now = nowSeconds();

    const result = await c.env.DB.prepare(
      `UPDATE sponsors SET thanked_at = ?, thanked_by = ?, updated_at = ?
        WHERE id = ? AND team_id = ?`,
    )
      .bind(
        body.thanked ? now : null,
        body.thanked ? member.id : null,
        now,
        c.req.param('id'),
        teamId,
      )
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

    const row = await c.env.DB.prepare(
      `SELECT ${SPONSOR_COLUMNS} FROM sponsors WHERE id = ? AND team_id = ?`,
    )
      .bind(c.req.param('id'), teamId)
      .first();
    return c.json({ sponsor: row });
  },
);

/**
 * The cheque arrived: book it on the ledger.
 *
 * COACH OR MENTOR ONLY, and this is the one route in this file with that gate.
 * Everything else here records intentions — a promise, a stage, a thank-you —
 * and students own those. This writes a `transactions` row, and the ledger is
 * the book of record that routes/finance.ts keeps in adult hands.
 *
 * No promote guard: a sponsor may pay in instalments, so this is legitimately
 * repeatable. The dialog disables its own submit while a request is in flight,
 * which is the right place for double-press protection when the action is
 * meant to be repeatable.
 *
 * Category is 'sponsorship', which 0009 reserved for precisely this moment.
 */
sponsorship.post(
  '/sponsors/:id/payments',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);
    const sponsorId = c.req.param('id');

    const sponsor = await c.env.DB.prepare(
      'SELECT id, season_id, name FROM sponsors WHERE id = ? AND team_id = ?',
    )
      .bind(sponsorId, teamId)
      .first<{ id: string; season_id: string; name: string }>();
    if (!sponsor) return c.json({ error: 'not_found' }, 404);

    const amount = boundedInt(body.amount_cents, 1, MAX_AMOUNT_CENTS);
    if (amount === null) return c.json({ error: 'invalid_amount' }, 400);
    const occurredAt = boundedInt(body.occurred_at, 0, MAX_EPOCH);
    if (occurredAt === null) return c.json({ error: 'invalid_occurred_at' }, 400);

    // Sponsorship is the archetypal money that carries over, so which pot it
    // lands in matters. The dialog pre-fills the default and a coach can send
    // it elsewhere.
    const fund = await resolveFundId(
      c.env.DB,
      teamId,
      body.fund_id as string | null | undefined,
    );
    if ('error' in fund) return c.json({ error: fund.error }, 400);

    const transactionId = uuid();
    const now = nowSeconds();
    await c.env.DB.prepare(
      `INSERT INTO transactions
         (id, team_id, season_id, kind, category, label, note, amount_cents,
          occurred_at, sponsor_id, fund_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'income', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        transactionId,
        teamId,
        // The SPONSOR's season, not the current one: a cheque for last season's
        // pledge belongs to that season's books. Same argument as receipts.
        sponsor.season_id,
        SPONSOR_PAYMENT_CATEGORY,
        `${sponsor.name} sponsorship`.slice(0, 200),
        optionalString(body.note, 1000),
        amount,
        occurredAt,
        sponsorId,
        fund.fundId,
        member.id,
        now,
        now,
      )
      .run();

    const paid = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents, COUNT(*) AS payment_count
         FROM transactions WHERE team_id = ? AND sponsor_id = ?`,
    )
      .bind(teamId, sponsorId)
      .first<{ paid_cents: number; payment_count: number }>();

    const transaction = await c.env.DB.prepare(
      `SELECT id, kind, category, label, note, amount_cents, occurred_at,
              sponsor_id, created_at
         FROM transactions WHERE id = ? AND team_id = ?`,
    )
      .bind(transactionId, teamId)
      .first();

    return c.json(
      {
        transaction,
        paid_cents: paid?.paid_cents ?? 0,
        payment_count: paid?.payment_count ?? 0,
      },
      201,
    );
  },
);

/**
 * Remove a sponsor.
 *
 * Refused while ledger lines point at it: money that arrived is not undone by
 * deleting who sent it, and the coach who wants this genuinely gone should
 * delete those lines first — a deliberate act, on the ledger, where it belongs.
 *
 * With no payments, the prospect that produced this sponsor is reopened at
 * 'pitched' rather than left holding a dangling 'committed'. The FK's SET NULL
 * clears the pointer on its own; the explicit UPDATE is what puts the
 * conversation back somewhere a human can act on it, and it runs FIRST so it
 * can still find the row by pointer.
 */
sponsorship.delete(
  '/sponsors/:id',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const { teamId, member } = authOf(c);
    const sponsorId = c.req.param('id');

    const sponsor = await c.env.DB.prepare(
      'SELECT id FROM sponsors WHERE id = ? AND team_id = ?',
    )
      .bind(sponsorId, teamId)
      .first();
    if (!sponsor) return c.json({ error: 'not_found' }, 404);

    const payments = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM transactions WHERE team_id = ? AND sponsor_id = ?',
    )
      .bind(teamId, sponsorId)
      .first<{ n: number }>();
    if ((payments?.n ?? 0) > 0) {
      return c.json({ error: 'sponsor_has_payments', payments: payments?.n ?? 0 }, 409);
    }

    const now = nowSeconds();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE sponsor_prospects
            SET stage = 'pitched', sponsor_id = NULL, stage_changed_by = ?,
                stage_changed_at = ?, updated_at = ?
          WHERE team_id = ? AND sponsor_id = ?`,
      ).bind(member.id, now, now, teamId, sponsorId),
      c.env.DB.prepare('DELETE FROM sponsors WHERE id = ? AND team_id = ?').bind(
        sponsorId,
        teamId,
      ),
    ]);

    return c.json({ ok: true });
  },
);

export { sponsorship };
