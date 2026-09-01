/**
 * Sponsorship campaigns: tiers, pitch CAS, the pipeline, promotion and money.
 *
 * Two groups of tests here are pins rather than coverage, and should be read as
 * statements of intent:
 *
 *   - VISIBILITY. Every read answers 200 to a viewer, and writes do not. That
 *     is a product decision (a sponsor is owed the money story), and a
 *     regression in either direction should fail loudly rather than quietly
 *     changing who can see the team's fundraising.
 *   - WHO MAY DO WHAT. Students run the pipeline including committing a
 *     sponsor; only a coach or mentor may record that money arrived. The line
 *     between "recording a promise" and "writing the ledger" is the whole
 *     permission design, so it gets its own tests.
 */
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { callJson, inviteAndAccept, signUpCoach, stubResend, whoami } from './_helpers';

beforeAll(() => {
  stubResend();
});

interface Campaign {
  id: string;
  name: string;
  goal_cents: number;
  rev: number;
  pitch?: string;
  pitch_text?: string;
  tiers?: Tier[];
  pledged_cents?: number;
  raised_cents?: number;
  stage_counts?: Record<string, number>;
}

interface Tier {
  id: string;
  name: string;
  amount_cents: number;
  position: number;
}

interface Prospect {
  id: string;
  org_name: string;
  stage: string;
  pledged_cents: number | null;
  tier_id: string | null;
  sponsor_id: string | null;
  stage_changed_by: string | null;
  stage_changed_at: number | null;
  contact_email: string | null;
}

interface Sponsor {
  id: string;
  name: string;
  tier_name: string | null;
  amount_cents: number;
  thanked_at: number | null;
  thanked_by: string | null;
  paid_cents?: number;
  payment_count?: number;
  prospect_id?: string | null;
}

/** A minimal valid ProseMirror doc, matching what DocEditor serialises. */
function pitchDoc(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
}

async function makeCampaign(
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: { campaign: Campaign; error?: string } }> {
  return callJson('/api/finance/campaigns', {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      name: '2026 season sponsorship drive',
      goal_cents: 250000,
      ...overrides,
    }),
  });
}

async function makeTier(
  cookie: string,
  campaignId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: { tier: Tier; error?: string } }> {
  return callJson(`/api/finance/campaigns/${campaignId}/tiers`, {
    method: 'POST',
    cookie,
    body: JSON.stringify({ name: 'Gold', amount_cents: 75000, ...overrides }),
  });
}

async function makeProspect(
  cookie: string,
  campaignId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: { prospect: Prospect; error?: string } }> {
  return callJson(`/api/finance/campaigns/${campaignId}/prospects`, {
    method: 'POST',
    cookie,
    body: JSON.stringify({ org_name: 'Harbor Machine Works', ...overrides }),
  });
}

// ------------------------------------------------------------------ campaigns

describe('campaigns', () => {
  it('creates, lists, edits and deletes a campaign', async () => {
    const cookie = await signUpCoach(6100);

    const created = await makeCampaign(cookie);
    expect(created.status).toBe(201);
    expect(created.body.campaign.rev).toBe(0);

    const list = await callJson<{ campaigns: Campaign[] }>('/api/finance/campaigns', {
      cookie,
    });
    expect(list.status).toBe(200);
    expect(list.body.campaigns).toHaveLength(1);
    // The list carries rollups and tiers but NOT the pitch body.
    expect(list.body.campaigns[0].pitch).toBeUndefined();
    expect(list.body.campaigns[0].tiers).toEqual([]);
    expect(list.body.campaigns[0].pledged_cents).toBe(0);
    expect(list.body.campaigns[0].raised_cents).toBe(0);

    // The single GET does carry it.
    const one = await callJson<{ campaign: Campaign }>(
      `/api/finance/campaigns/${created.body.campaign.id}`,
      { cookie },
    );
    expect(one.status).toBe(200);
    expect(typeof one.body.campaign.pitch).toBe('string');

    const patched = await callJson<{ campaign: Campaign }>(
      `/api/finance/campaigns/${created.body.campaign.id}`,
      { method: 'PATCH', cookie, body: JSON.stringify({ goal_cents: 300000 }) },
    );
    expect(patched.status).toBe(200);
    expect(patched.body.campaign.goal_cents).toBe(300000);

    const deleted = await callJson(
      `/api/finance/campaigns/${created.body.campaign.id}`,
      { method: 'DELETE', cookie },
    );
    expect(deleted.status).toBe(200);
  });

  it('validates name and goal, and needs a season', async () => {
    const cookie = await signUpCoach(6101);
    expect((await makeCampaign(cookie, { name: '   ' })).status).toBe(400);
    expect((await makeCampaign(cookie, { goal_cents: 0 })).status).toBe(400);
    expect((await makeCampaign(cookie, { goal_cents: 1.5 })).status).toBe(400);

    const empty = await callJson<{ error: string }>(
      `/api/finance/campaigns/${(await makeCampaign(cookie)).body.campaign.id}`,
      { method: 'PATCH', cookie, body: JSON.stringify({}) },
    );
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('nothing_to_update');
  });

  it('refuses to delete a campaign that has a pipeline', async () => {
    const cookie = await signUpCoach(6102);
    const campaign = (await makeCampaign(cookie)).body.campaign;
    await makeProspect(cookie, campaign.id);

    const refused = await callJson<{ error: string }>(
      `/api/finance/campaigns/${campaign.id}`,
      { method: 'DELETE', cookie },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('campaign_in_use');
  });

  it("answers 404 for another team's campaign", async () => {
    const cookieA = await signUpCoach(6103);
    const cookieB = await signUpCoach(6104);
    const campaign = (await makeCampaign(cookieA)).body.campaign;

    for (const [path, init] of [
      [`/api/finance/campaigns/${campaign.id}`, { cookie: cookieB }],
      [
        `/api/finance/campaigns/${campaign.id}`,
        { method: 'PATCH', cookie: cookieB, body: JSON.stringify({ name: 'theirs' }) },
      ],
      [
        `/api/finance/campaigns/${campaign.id}/tiers`,
        { method: 'POST', cookie: cookieB, body: JSON.stringify({ name: 'X', amount_cents: 100 }) },
      ],
      [`/api/finance/campaigns/${campaign.id}/prospects`, { cookie: cookieB }],
    ] as const) {
      const response = await callJson(path, init as Record<string, unknown>);
      expect(response.status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------- visibility

describe('visibility and permissions', () => {
  it('lets every role read and only non-viewers write', async () => {
    const coach = await signUpCoach(6110);
    const { cookie: student } = await inviteAndAccept(coach, {
      role: 'student',
      handle: 'spons-student',
    });
    const { cookie: viewer } = await inviteAndAccept(coach, {
      role: 'viewer',
      handle: 'spons-viewer',
    });
    const campaign = (await makeCampaign(coach)).body.campaign;

    // Reads: everyone, viewers included. The product decision, pinned.
    for (const cookie of [student, viewer]) {
      expect((await callJson('/api/finance/campaigns', { cookie })).status).toBe(200);
      expect(
        (await callJson(`/api/finance/campaigns/${campaign.id}`, { cookie })).status,
      ).toBe(200);
      expect(
        (await callJson(`/api/finance/campaigns/${campaign.id}/prospects`, { cookie }))
          .status,
      ).toBe(200);
      expect((await callJson('/api/finance/sponsors', { cookie })).status).toBe(200);
    }

    // Students own the pipeline end to end.
    expect((await makeCampaign(student, { name: 'Student drive' })).status).toBe(201);
    expect((await makeTier(student, campaign.id)).status).toBe(201);
    expect((await makeProspect(student, campaign.id)).status).toBe(201);

    // Viewers write nothing.
    expect((await makeCampaign(viewer, { name: 'Nope' })).status).toBe(403);
    expect((await makeTier(viewer, campaign.id, { name: 'Nope' })).status).toBe(403);
    expect((await makeProspect(viewer, campaign.id, { org_name: 'Nope' })).status).toBe(403);
  });

  it('lets a student commit but only an adult record a payment', async () => {
    const coach = await signUpCoach(6111);
    const { cookie: student } = await inviteAndAccept(coach, {
      role: 'student',
      handle: 'commit-student',
    });
    const campaign = (await makeCampaign(coach)).body.campaign;
    const prospect = (
      await makeProspect(student, campaign.id, { pledged_cents: 50000 })
    ).body.prospect;

    // Recording a promise is the student's job.
    const committed = await callJson<{ sponsor: Sponsor }>(
      `/api/finance/prospects/${prospect.id}/commit`,
      { method: 'POST', cookie: student, body: JSON.stringify({}) },
    );
    expect(committed.status).toBe(201);
    const sponsorId = committed.body.sponsor.id;

    // Writing the ledger is not.
    const refused = await callJson<{ error: string }>(
      `/api/finance/sponsors/${sponsorId}/payments`,
      {
        method: 'POST',
        cookie: student,
        body: JSON.stringify({ amount_cents: 50000, occurred_at: 1_760_000_000 }),
      },
    );
    expect(refused.status).toBe(403);

    const allowed = await callJson(`/api/finance/sponsors/${sponsorId}/payments`, {
      method: 'POST',
      cookie: coach,
      body: JSON.stringify({ amount_cents: 50000, occurred_at: 1_760_000_000 }),
    });
    expect(allowed.status).toBe(201);

    // Thanking is a student's job too.
    const thanked = await callJson<{ sponsor: Sponsor }>(
      `/api/finance/sponsors/${sponsorId}/thanked`,
      { method: 'POST', cookie: student, body: JSON.stringify({ thanked: true }) },
    );
    expect(thanked.status).toBe(200);
  });
});

// ---------------------------------------------------------------------- pitch

describe('pitch', () => {
  it('saves on a compare-and-swap and reports a stale write', async () => {
    const cookie = await signUpCoach(6120);
    const campaign = (await makeCampaign(cookie)).body.campaign;
    const url = `/api/finance/campaigns/${campaign.id}/pitch`;

    const first = await callJson<{ campaign: Campaign }>(url, {
      method: 'PUT',
      cookie,
      body: JSON.stringify({ content: pitchDoc('Back the Cog Goblins'), base_rev: 0 }),
    });
    expect(first.status).toBe(200);
    expect(first.body.campaign.rev).toBe(1);
    expect(first.body.campaign.pitch_text).toBe('Back the Cog Goblins');

    // A writer still holding rev 0 loses, and is handed the server's copy.
    const stale = await callJson<{ error: string; campaign: Campaign }>(url, {
      method: 'PUT',
      cookie,
      body: JSON.stringify({ content: pitchDoc('Clobbered'), base_rev: 0 }),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('stale_content');
    expect(stale.body.campaign.rev).toBe(1);

    // A no-op save writes nothing and does not bump the rev.
    const unchanged = await callJson<{ unchanged: boolean; campaign: Campaign }>(url, {
      method: 'PUT',
      cookie,
      body: JSON.stringify({ content: pitchDoc('Back the Cog Goblins'), base_rev: 1 }),
    });
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.unchanged).toBe(true);
    expect(unchanged.body.campaign.rev).toBe(1);
  });

  it('refuses content the allowlist does not recognise', async () => {
    const cookie = await signUpCoach(6121);
    const campaign = (await makeCampaign(cookie)).body.campaign;
    const url = `/api/finance/campaigns/${campaign.id}/pitch`;

    // Not a string.
    expect(
      (await callJson(url, { method: 'PUT', cookie, body: JSON.stringify({ content: { type: 'doc' } }) }))
        .status,
    ).toBe(400);

    // A node type outside DOC_NODE_TYPES.
    const forged = JSON.stringify({
      type: 'doc',
      content: [{ type: 'script', content: [] }],
    });
    const rejected = await callJson<{ error: string }>(url, {
      method: 'PUT',
      cookie,
      body: JSON.stringify({ content: forged }),
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe('invalid_content');

    // Oversized is a 409, not a 400: the client can act on it by trimming.
    const huge = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(210_000) }] },
      ],
    });
    const tooBig = await callJson<{ error: string }>(url, {
      method: 'PUT',
      cookie,
      body: JSON.stringify({ content: huge }),
    });
    expect(tooBig.status).toBe(409);
    expect(tooBig.body.error).toBe('content_too_large');
  });
});

// ---------------------------------------------------------------------- tiers

describe('tiers', () => {
  it('creates, edits, reorders and deletes tiers', async () => {
    const cookie = await signUpCoach(6130);
    const campaign = (await makeCampaign(cookie)).body.campaign;

    const bronze = (await makeTier(cookie, campaign.id, { name: 'Bronze', amount_cents: 10000 }))
      .body.tier;
    const silver = (await makeTier(cookie, campaign.id, { name: 'Silver', amount_cents: 25000 }))
      .body.tier;
    const gold = (await makeTier(cookie, campaign.id, { name: 'Gold', amount_cents: 75000 }))
      .body.tier;
    expect(bronze.position).toBeLessThan(silver.position);
    expect(silver.position).toBeLessThan(gold.position);

    const renamed = await callJson<{ tier: Tier }>(
      `/api/finance/campaigns/${campaign.id}/tiers/${silver.id}`,
      { method: 'PATCH', cookie, body: JSON.stringify({ amount_cents: 30000 }) },
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.tier.amount_cents).toBe(30000);

    // Reorder: gold first.
    const reordered = await callJson<{ tiers: Tier[] }>(
      `/api/finance/campaigns/${campaign.id}/tiers/order`,
      {
        method: 'PUT',
        cookie,
        body: JSON.stringify({ ids: [gold.id, silver.id, bronze.id] }),
      },
    );
    expect(reordered.status).toBe(200);
    expect(reordered.body.tiers.map((t) => t.name)).toEqual(['Gold', 'Silver', 'Bronze']);

    // A partial list is refused rather than silently interleaved.
    const partial = await callJson<{ error: string }>(
      `/api/finance/campaigns/${campaign.id}/tiers/order`,
      { method: 'PUT', cookie, body: JSON.stringify({ ids: [gold.id] }) },
    );
    expect(partial.status).toBe(409);
    expect(partial.body.error).toBe('stale_order');

    const removed = await callJson(
      `/api/finance/campaigns/${campaign.id}/tiers/${bronze.id}`,
      { method: 'DELETE', cookie },
    );
    expect(removed.status).toBe(200);
  });

  it('leaves a sponsor tier_name intact when the tier is deleted', async () => {
    const cookie = await signUpCoach(6131);
    const campaign = (await makeCampaign(cookie)).body.campaign;
    const tier = (await makeTier(cookie, campaign.id, { name: 'Gold' })).body.tier;
    const prospect = (await makeProspect(cookie, campaign.id, { tier_id: tier.id })).body
      .prospect;

    const committed = await callJson<{ sponsor: Sponsor }>(
      `/api/finance/prospects/${prospect.id}/commit`,
      { method: 'POST', cookie, body: JSON.stringify({}) },
    );
    expect(committed.body.sponsor.tier_name).toBe('Gold');
    // Committing with no explicit amount falls back to the tier's price.
    expect(committed.body.sponsor.amount_cents).toBe(75000);

    await callJson(`/api/finance/campaigns/${campaign.id}/tiers/${tier.id}`, {
      method: 'DELETE',
      cookie,
    });

    const sponsors = await callJson<{ sponsors: Sponsor[] }>('/api/finance/sponsors', {
      cookie,
    });
    // The snapshot survives; the live link does not.
    expect(sponsors.body.sponsors[0].tier_name).toBe('Gold');
    expect(await env.DB.prepare('SELECT tier_id FROM sponsors WHERE id = ?')
      .bind(committed.body.sponsor.id)
      .first<{ tier_id: string | null }>()).toEqual({ tier_id: null });
  });

  it('caps the number of tiers', async () => {
    const cookie = await signUpCoach(6132);
    const campaign = (await makeCampaign(cookie)).body.campaign;
    for (let i = 0; i < 12; i++) {
      expect((await makeTier(cookie, campaign.id, { name: `T${i}` })).status).toBe(201);
    }
    const overflow = await makeTier(cookie, campaign.id, { name: 'One too many' });
    expect(overflow.status).toBe(409);
    expect(overflow.body.error).toBe('too_many_tiers');
  });
});

// ------------------------------------------------------------------ prospects

describe('prospects', () => {
  it('walks the pipeline and stamps who moved it', async () => {
    const coach = await signUpCoach(6140);
    const { cookie: student } = await inviteAndAccept(coach, {
      role: 'student',
      handle: 'stage-student',
    });
    const studentId = (await whoami(student)).member_id;
    const campaign = (await makeCampaign(coach)).body.campaign;
    const prospect = (await makeProspect(coach, campaign.id)).body.prospect;
    expect(prospect.stage).toBe('researching');

    for (const stage of ['contacted', 'pitched', 'declined'] as const) {
      const moved = await callJson<{ prospect: Prospect }>(
        `/api/finance/prospects/${prospect.id}`,
        { method: 'PATCH', cookie: student, body: JSON.stringify({ stage }) },
      );
      expect(moved.status).toBe(200);
      expect(moved.body.prospect.stage).toBe(stage);
      expect(moved.body.prospect.stage_changed_by).toBe(studentId);
      expect(moved.body.prospect.stage_changed_at).not.toBeNull();
    }

    // 'committed' is not settable here — it creates money state, so it has its
    // own route and its own guard.
    const refused = await callJson<{ error: string }>(
      `/api/finance/prospects/${prospect.id}`,
      { method: 'PATCH', cookie: student, body: JSON.stringify({ stage: 'committed' }) },
    );
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('invalid_stage');

    expect(
      (await callJson(`/api/finance/prospects/${prospect.id}`, {
        method: 'PATCH',
        cookie: student,
        body: JSON.stringify({ stage: 'ghosted' }),
      })).status,
    ).toBe(400);
  });

  it('stores contact details and validates the email and link', async () => {
    const cookie = await signUpCoach(6141);
    const campaign = (await makeCampaign(cookie)).body.campaign;

    const created = await makeProspect(cookie, campaign.id, {
      contact_name: 'Dana Reyes',
      contact_email: 'dana@harbormachine.example',
      contact_phone: '410-555-0134',
      url: 'https://harbormachine.example',
    });
    expect(created.status).toBe(201);
    expect(created.body.prospect.contact_email).toBe('dana@harbormachine.example');

    const badEmail = await makeProspect(cookie, campaign.id, {
      org_name: 'Bad email',
      contact_email: 'not-an-address',
    });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error).toBe('invalid_email');

    const badUrl = await makeProspect(cookie, campaign.id, {
      org_name: 'Bad url',
      url: 'javascript:alert(1)',
    });
    expect(badUrl.status).toBe(400);
    expect(badUrl.body.error).toBe('invalid_url');
  });

  it('refuses a tier from another campaign', async () => {
    const cookie = await signUpCoach(6142);
    const first = (await makeCampaign(cookie)).body.campaign;
    const second = (await makeCampaign(cookie, { name: 'Second' })).body.campaign;
    const tier = (await makeTier(cookie, first.id)).body.tier;

    const refused = await makeProspect(cookie, second.id, { tier_id: tier.id });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('invalid_tier');
  });
});

// -------------------------------------------------------------------- commit

describe('commit', () => {
  it('promotes once, and a second press is a 409 with one sponsor', async () => {
    const cookie = await signUpCoach(6150);
    const teamId = (await whoami(cookie)).team_id;
    const campaign = (await makeCampaign(cookie)).body.campaign;
    const prospect = (
      await makeProspect(cookie, campaign.id, { pledged_cents: 40000 })
    ).body.prospect;

    const first = await callJson<{ sponsor: Sponsor; prospect: Prospect }>(
      `/api/finance/prospects/${prospect.id}/commit`,
      { method: 'POST', cookie, body: JSON.stringify({}) },
    );
    expect(first.status).toBe(201);
    expect(first.body.sponsor.amount_cents).toBe(40000);
    expect(first.body.prospect.stage).toBe('committed');
    expect(first.body.prospect.sponsor_id).toBe(first.body.sponsor.id);

    const second = await callJson<{ error: string }>(
      `/api/finance/prospects/${prospect.id}/commit`,
      { method: 'POST', cookie, body: JSON.stringify({}) },
    );
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('already_committed');

    // The pin: exactly one sponsor row for THIS team, so the losing attempt
    // left no orphan behind. Scoped by team id because every suite in this file
    // shares one database.
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM sponsors WHERE team_id = ?',
    )
      .bind(teamId)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('needs an amount from somewhere', async () => {
    const cookie = await signUpCoach(6151);
    const campaign = (await makeCampaign(cookie)).body.campaign;
    const bare = (await makeProspect(cookie, campaign.id)).body.prospect;

    const refused = await callJson<{ error: string }>(
      `/api/finance/prospects/${bare.id}/commit`,
      { method: 'POST', cookie, body: JSON.stringify({}) },
    );
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('missing_amount');

    // An explicit amount wins over everything else.
    const explicit = await callJson<{ sponsor: Sponsor }>(
      `/api/finance/prospects/${bare.id}/commit`,
      { method: 'POST', cookie, body: JSON.stringify({ amount_cents: 12345 }) },
    );
    expect(explicit.status).toBe(201);
    expect(explicit.body.sponsor.amount_cents).toBe(12345);
  });

  it('freezes a committed prospect', async () => {
    const cookie = await signUpCoach(6152);
    const campaign = (await makeCampaign(cookie)).body.campaign;
    const prospect = (
      await makeProspect(cookie, campaign.id, { pledged_cents: 10000 })
    ).body.prospect;
    await callJson(`/api/finance/prospects/${prospect.id}/commit`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({}),
    });

    const edited = await callJson<{ error: string }>(
      `/api/finance/prospects/${prospect.id}`,
      { method: 'PATCH', cookie, body: JSON.stringify({ org_name: 'Renamed' }) },
    );
    expect(edited.status).toBe(409);
    expect(edited.body.error).toBe('already_committed');

    const deleted = await callJson<{ error: string }>(
      `/api/finance/prospects/${prospect.id}`,
      { method: 'DELETE', cookie },
    );
    expect(deleted.status).toBe(409);
    expect(deleted.body.error).toBe('already_committed');
  });
});

// ------------------------------------------------------------------- sponsors

describe('sponsors and payments', () => {
  it('sums instalments, feeds the ledger, and rolls up to the campaign', async () => {
    const cookie = await signUpCoach(6160);
    const campaign = (await makeCampaign(cookie, { goal_cents: 200000 })).body.campaign;
    const prospect = (
      await makeProspect(cookie, campaign.id, { pledged_cents: 150000 })
    ).body.prospect;
    const sponsor = (
      await callJson<{ sponsor: Sponsor }>(
        `/api/finance/prospects/${prospect.id}/commit`,
        { method: 'POST', cookie, body: JSON.stringify({}) },
      )
    ).body.sponsor;

    // Two cheques, because that is how a $1,500 sponsor usually pays.
    for (const amount of [100000, 50000]) {
      const payment = await callJson<{ paid_cents: number }>(
        `/api/finance/sponsors/${sponsor.id}/payments`,
        {
          method: 'POST',
          cookie,
          body: JSON.stringify({ amount_cents: amount, occurred_at: 1_760_000_000 }),
        },
      );
      expect(payment.status).toBe(201);
    }

    const sponsors = await callJson<{ sponsors: Sponsor[] }>('/api/finance/sponsors', {
      cookie,
    });
    expect(sponsors.body.sponsors[0].paid_cents).toBe(150000);
    expect(sponsors.body.sponsors[0].payment_count).toBe(2);
    // Provenance: the sponsor knows which prospect produced it.
    expect(sponsors.body.sponsors[0].prospect_id).toBe(prospect.id);

    // The payments are ordinary income on the ledger, in the reserved category.
    const ledger = await callJson<{
      transactions: { kind: string; category: string; amount_cents: number }[];
    }>('/api/finance/transactions', { cookie });
    expect(ledger.body.transactions).toHaveLength(2);
    expect(ledger.body.transactions.every((t) => t.kind === 'income')).toBe(true);
    expect(ledger.body.transactions.every((t) => t.category === 'sponsorship')).toBe(true);

    // And they show in the finance summary phase 1 already ships.
    const summary = await callJson<{ income_cents: number }>('/api/finance/summary', {
      cookie,
    });
    expect(summary.body.income_cents).toBe(150000);

    // The campaign rollup separates promised from arrived.
    const campaigns = await callJson<{ campaigns: Campaign[] }>('/api/finance/campaigns', {
      cookie,
    });
    expect(campaigns.body.campaigns[0].pledged_cents).toBe(150000);
    expect(campaigns.body.campaigns[0].raised_cents).toBe(150000);
    expect(campaigns.body.campaigns[0].stage_counts).toEqual({ committed: 1 });
  });

  it('records and clears a thank-you', async () => {
    const cookie = await signUpCoach(6161);
    const me = (await whoami(cookie)).member_id;
    const created = await callJson<{ sponsor: Sponsor }>('/api/finance/sponsors', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name: 'Riverside Dental', amount_cents: 25000 }),
    });
    expect(created.status).toBe(201);
    expect(created.body.sponsor.thanked_at).toBeNull();

    const thanked = await callJson<{ sponsor: Sponsor }>(
      `/api/finance/sponsors/${created.body.sponsor.id}/thanked`,
      { method: 'POST', cookie, body: JSON.stringify({ thanked: true }) },
    );
    expect(thanked.body.sponsor.thanked_at).not.toBeNull();
    expect(thanked.body.sponsor.thanked_by).toBe(me);

    const cleared = await callJson<{ sponsor: Sponsor }>(
      `/api/finance/sponsors/${created.body.sponsor.id}/thanked`,
      { method: 'POST', cookie, body: JSON.stringify({ thanked: false }) },
    );
    expect(cleared.body.sponsor.thanked_at).toBeNull();
    expect(cleared.body.sponsor.thanked_by).toBeNull();
  });

  it('refuses to delete a sponsor that has been paid, and reopens one that has not', async () => {
    const cookie = await signUpCoach(6162);
    const campaign = (await makeCampaign(cookie)).body.campaign;

    // Paid: refused.
    const paidProspect = (
      await makeProspect(cookie, campaign.id, { org_name: 'Paid Co', pledged_cents: 20000 })
    ).body.prospect;
    const paidSponsor = (
      await callJson<{ sponsor: Sponsor }>(
        `/api/finance/prospects/${paidProspect.id}/commit`,
        { method: 'POST', cookie, body: JSON.stringify({}) },
      )
    ).body.sponsor;
    await callJson(`/api/finance/sponsors/${paidSponsor.id}/payments`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ amount_cents: 20000, occurred_at: 1_760_000_000 }),
    });
    const refused = await callJson<{ error: string }>(
      `/api/finance/sponsors/${paidSponsor.id}`,
      { method: 'DELETE', cookie },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('sponsor_has_payments');

    // Unpaid: deleted, and the prospect goes back to being a live conversation.
    const openProspect = (
      await makeProspect(cookie, campaign.id, { org_name: 'Unpaid Co', pledged_cents: 30000 })
    ).body.prospect;
    const openSponsor = (
      await callJson<{ sponsor: Sponsor }>(
        `/api/finance/prospects/${openProspect.id}/commit`,
        { method: 'POST', cookie, body: JSON.stringify({}) },
      )
    ).body.sponsor;
    const deleted = await callJson(`/api/finance/sponsors/${openSponsor.id}`, {
      method: 'DELETE',
      cookie,
    });
    expect(deleted.status).toBe(200);

    const prospects = await callJson<{ prospects: Prospect[] }>(
      `/api/finance/campaigns/${campaign.id}/prospects`,
      { cookie },
    );
    const reopened = prospects.body.prospects.find((p) => p.id === openProspect.id);
    expect(reopened?.stage).toBe('pitched');
    expect(reopened?.sponsor_id).toBeNull();

    // And it can be committed again.
    const recommitted = await callJson(
      `/api/finance/prospects/${openProspect.id}/commit`,
      { method: 'POST', cookie, body: JSON.stringify({}) },
    );
    expect(recommitted.status).toBe(201);
  });

  it("answers 404 for another team's sponsor on every route", async () => {
    const cookieA = await signUpCoach(6163);
    const cookieB = await signUpCoach(6164);
    const sponsor = (
      await callJson<{ sponsor: Sponsor }>('/api/finance/sponsors', {
        method: 'POST',
        cookie: cookieA,
        body: JSON.stringify({ name: 'Theirs', amount_cents: 10000 }),
      })
    ).body.sponsor;

    for (const init of [
      { method: 'PATCH', body: JSON.stringify({ name: 'Mine now' }) },
      { method: 'POST', body: JSON.stringify({ thanked: true }) },
      { method: 'DELETE' },
    ] as const) {
      const path =
        init.method === 'POST'
          ? `/api/finance/sponsors/${sponsor.id}/thanked`
          : `/api/finance/sponsors/${sponsor.id}`;
      const response = await callJson(path, { ...init, cookie: cookieB });
      expect(response.status).toBe(404);
    }

    const payment = await callJson(`/api/finance/sponsors/${sponsor.id}/payments`, {
      method: 'POST',
      cookie: cookieB,
      body: JSON.stringify({ amount_cents: 100, occurred_at: 1_760_000_000 }),
    });
    expect(payment.status).toBe(404);
  });
});
