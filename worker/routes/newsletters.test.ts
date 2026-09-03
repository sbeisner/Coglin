/**
 * The contact list and the newsletters written for it.
 *
 * Two groups of tests here are pins on decisions rather than coverage:
 *
 *   - NOTHING CLAIMS A SEND THAT DID NOT HAPPEN. 'sent' is unreachable through
 *     an ordinary edit, and a scheduled newsletter whose date has passed is
 *     still scheduled. If a cron ever gets added, these fail.
 *   - AN OPT-OUT IS REMEMBERED. Importing sponsors twice does not re-add
 *     somebody who asked to be taken off, which is the entire reason
 *     `unsubscribed_at` is kept rather than cleared.
 */
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { callJson, inviteAndAccept, signUpCoach, stubResend, whoami } from './_helpers';

beforeAll(() => {
  stubResend();
});

interface Contact {
  id: string;
  org_name: string | null;
  contact_name: string | null;
  email: string;
  subscribed_at: number | null;
  subscribed_by: string | null;
  unsubscribed_at: number | null;
  sponsor_id: string | null;
}

interface Newsletter {
  id: string;
  title: string;
  body?: string;
  body_text: string;
  rev: number;
  status: string;
  scheduled_for: number | null;
  sent_at: number | null;
  sent_by: string | null;
  recipient_count: number | null;
}

function bodyDoc(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
}

async function makeContact(
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: { contact: Contact; error?: string } }> {
  return callJson('/api/contacts', {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      org_name: 'Harbor Machine Works',
      contact_name: 'Dana Reyes',
      email: 'dana@harbormachine.example',
      ...overrides,
    }),
  });
}

async function makeNewsletter(
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: { newsletter: Newsletter; error?: string } }> {
  return callJson('/api/newsletters', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ title: 'Autumn season update', ...overrides }),
  });
}

/** A committed sponsor whose prospect carries a contact email, for the import. */
async function makeSponsorWithContact(
  cookie: string,
  org: string,
  email: string | null,
): Promise<void> {
  const campaign = await callJson<{ campaign: { id: string } }>(
    '/api/finance/campaigns',
    {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name: `${org} drive`, goal_cents: 100000 }),
    },
  );
  const prospect = await callJson<{ prospect: { id: string } }>(
    `/api/finance/campaigns/${campaign.body.campaign.id}/prospects`,
    {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        org_name: org,
        contact_name: 'A Person',
        contact_email: email,
        pledged_cents: 25000,
      }),
    },
  );
  const committed = await callJson(
    `/api/finance/prospects/${prospect.body.prospect.id}/commit`,
    { method: 'POST', cookie, body: JSON.stringify({}) },
  );
  expect(committed.status).toBe(201);
}

// -------------------------------------------------------------------- contacts

describe('contacts', () => {
  it('creates, lists, edits and removes a contact', async () => {
    const cookie = await signUpCoach(7200);
    const me = (await whoami(cookie)).member_id;

    const created = await makeContact(cookie);
    expect(created.status).toBe(201);
    // A contact typed into a "who gets our updates" form is subscribed.
    expect(created.body.contact.subscribed_at).not.toBeNull();
    expect(created.body.contact.subscribed_by).toBe(me);

    const list = await callJson<{ contacts: Contact[] }>('/api/contacts', { cookie });
    expect(list.status).toBe(200);
    expect(list.body.contacts).toHaveLength(1);

    const patched = await callJson<{ contact: Contact }>(
      `/api/contacts/${created.body.contact.id}`,
      { method: 'PATCH', cookie, body: JSON.stringify({ contact_name: 'D. Reyes' }) },
    );
    expect(patched.status).toBe(200);
    expect(patched.body.contact.contact_name).toBe('D. Reyes');

    const removed = await callJson(`/api/contacts/${created.body.contact.id}`, {
      method: 'DELETE',
      cookie,
    });
    expect(removed.status).toBe(200);
  });

  it('lower-cases addresses and refuses a duplicate', async () => {
    const cookie = await signUpCoach(7201);
    const first = await makeContact(cookie, { email: 'Dana@Harbor.Example' });
    expect(first.status).toBe(201);
    expect(first.body.contact.email).toBe('dana@harbor.example');

    // Same person, different capitalisation — a list that mails them twice is
    // a list nobody trusts.
    const dupe = await makeContact(cookie, { email: 'dana@harbor.example' });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error).toBe('duplicate_email');
  });

  it('validates the address', async () => {
    const cookie = await signUpCoach(7202);
    expect((await makeContact(cookie, { email: '  ' })).status).toBe(400);
    const bad = await makeContact(cookie, { email: 'not-an-address' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_email');
  });

  it('records an opt-out rather than clearing the opt-in', async () => {
    const cookie = await signUpCoach(7203);
    const contact = (await makeContact(cookie)).body.contact;

    const out = await callJson<{ contact: Contact }>(
      `/api/contacts/${contact.id}/subscription`,
      { method: 'POST', cookie, body: JSON.stringify({ subscribed: false }) },
    );
    expect(out.status).toBe(200);
    // The opt-in timestamp survives; the opt-out is newer and therefore wins.
    expect(out.body.contact.subscribed_at).not.toBeNull();
    expect(out.body.contact.unsubscribed_at).not.toBeNull();

    const back = await callJson<{ contact: Contact }>(
      `/api/contacts/${contact.id}/subscription`,
      { method: 'POST', cookie, body: JSON.stringify({ subscribed: true }) },
    );
    expect(back.body.contact.subscribed_at!).toBeGreaterThanOrEqual(
      back.body.contact.unsubscribed_at!,
    );
  });
});

// ---------------------------------------------------------------------- import

describe('sponsor import', () => {
  it('imports sponsor contacts once and skips the rest', async () => {
    const cookie = await signUpCoach(7210);
    await makeSponsorWithContact(cookie, 'Harbor Machine', 'dana@harbor.example');
    await makeSponsorWithContact(cookie, 'Riverside Dental', 'front@riverside.example');
    // No address: nothing to import, and not an error.
    await makeSponsorWithContact(cookie, 'Bayside Hardware', null);

    const first = await callJson<{ imported: number; skipped: number }>(
      '/api/contacts/import-sponsors',
      { method: 'POST', cookie },
    );
    expect(first.status).toBe(200);
    expect(first.body.imported).toBe(2);

    const list = await callJson<{ contacts: Contact[] }>('/api/contacts', { cookie });
    expect(list.body.contacts).toHaveLength(2);
    // Provenance, and subscribed on the way in.
    expect(list.body.contacts.every((contact) => contact.sponsor_id !== null)).toBe(true);
    expect(list.body.contacts.every((contact) => contact.subscribed_at !== null)).toBe(true);

    // Idempotent: running it again adds nobody.
    const second = await callJson<{ imported: number; skipped: number }>(
      '/api/contacts/import-sponsors',
      { method: 'POST', cookie },
    );
    expect(second.body.imported).toBe(0);
    expect(second.body.skipped).toBe(2);
  });

  it('never re-adds somebody who asked to be taken off', async () => {
    const cookie = await signUpCoach(7211);
    await makeSponsorWithContact(cookie, 'Harbor Machine', 'dana@harbor.example');
    await callJson('/api/contacts/import-sponsors', { method: 'POST', cookie });

    const contact = (await callJson<{ contacts: Contact[] }>('/api/contacts', { cookie }))
      .body.contacts[0];
    await callJson(`/api/contacts/${contact.id}/subscription`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ subscribed: false }),
    });

    // The import must not undo that. The row still exists, so it is skipped.
    const again = await callJson<{ imported: number }>('/api/contacts/import-sponsors', {
      method: 'POST',
      cookie,
    });
    expect(again.body.imported).toBe(0);

    const after = (await callJson<{ contacts: Contact[] }>('/api/contacts', { cookie }))
      .body.contacts[0];
    expect(after.unsubscribed_at).not.toBeNull();
  });
});

// ------------------------------------------------------------------ newsletters

describe('newsletters', () => {
  it('creates, edits, saves a body on a CAS and deletes', async () => {
    const cookie = await signUpCoach(7220);
    const created = await makeNewsletter(cookie);
    expect(created.status).toBe(201);
    expect(created.body.newsletter.status).toBe('draft');
    expect(created.body.newsletter.rev).toBe(0);
    const id = created.body.newsletter.id;

    const saved = await callJson<{ newsletter: Newsletter }>(
      `/api/newsletters/${id}/body`,
      {
        method: 'PUT',
        cookie,
        body: JSON.stringify({ content: bodyDoc('Here is what you built.'), base_rev: 0 }),
      },
    );
    expect(saved.status).toBe(200);
    expect(saved.body.newsletter.rev).toBe(1);
    expect(saved.body.newsletter.body_text).toBe('Here is what you built.');

    const stale = await callJson<{ error: string }>(`/api/newsletters/${id}/body`, {
      method: 'PUT',
      cookie,
      body: JSON.stringify({ content: bodyDoc('Clobbered'), base_rev: 0 }),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('stale_content');

    const unchanged = await callJson<{ unchanged: boolean }>(
      `/api/newsletters/${id}/body`,
      {
        method: 'PUT',
        cookie,
        body: JSON.stringify({ content: bodyDoc('Here is what you built.'), base_rev: 1 }),
      },
    );
    expect(unchanged.body.unchanged).toBe(true);

    // The list omits the body; the single read carries it.
    const list = await callJson<{ newsletters: Newsletter[] }>('/api/newsletters', {
      cookie,
    });
    expect(list.body.newsletters[0].body).toBeUndefined();
    const one = await callJson<{ newsletter: Newsletter }>(`/api/newsletters/${id}`, {
      cookie,
    });
    expect(typeof one.body.newsletter.body).toBe('string');

    expect(
      (await callJson(`/api/newsletters/${id}`, { method: 'DELETE', cookie })).status,
    ).toBe(200);
  });

  it('refuses a body the allowlist does not recognise', async () => {
    const cookie = await signUpCoach(7221);
    const id = (await makeNewsletter(cookie)).body.newsletter.id;

    const forged = JSON.stringify({ type: 'doc', content: [{ type: 'iframe' }] });
    const rejected = await callJson<{ error: string }>(`/api/newsletters/${id}/body`, {
      method: 'PUT',
      cookie,
      body: JSON.stringify({ content: forged }),
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe('invalid_content');
  });

  it('schedules without ever claiming a send', async () => {
    const cookie = await signUpCoach(7222);
    const id = (await makeNewsletter(cookie)).body.newsletter.id;

    // A date in the PAST, which is the case a cron would have acted on.
    const scheduled = await callJson<{ newsletter: Newsletter }>(
      `/api/newsletters/${id}`,
      {
        method: 'PATCH',
        cookie,
        body: JSON.stringify({ status: 'scheduled', scheduled_for: 1_600_000_000 }),
      },
    );
    expect(scheduled.status).toBe(200);
    expect(scheduled.body.newsletter.status).toBe('scheduled');

    // Re-read: still scheduled, still unsent. Nothing in this system flips it.
    const reread = await callJson<{ newsletter: Newsletter }>(`/api/newsletters/${id}`, {
      cookie,
    });
    expect(reread.body.newsletter.status).toBe('scheduled');
    expect(reread.body.newsletter.sent_at).toBeNull();

    // And 'sent' is not reachable through an ordinary edit.
    const refused = await callJson<{ error: string }>(`/api/newsletters/${id}`, {
      method: 'PATCH',
      cookie,
      body: JSON.stringify({ status: 'sent' }),
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('invalid_status');
  });

  it('marks sent with a recipient snapshot, once', async () => {
    const cookie = await signUpCoach(7223);
    const me = (await whoami(cookie)).member_id;
    await makeContact(cookie, { email: 'one@example.test' });
    await makeContact(cookie, { email: 'two@example.test' });
    const optedOut = (await makeContact(cookie, { email: 'three@example.test' })).body
      .contact;
    await callJson(`/api/contacts/${optedOut.id}/subscription`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ subscribed: false }),
    });

    const id = (await makeNewsletter(cookie)).body.newsletter.id;
    const sent = await callJson<{ newsletter: Newsletter }>(
      `/api/newsletters/${id}/sent`,
      { method: 'POST', cookie },
    );
    expect(sent.status).toBe(200);
    expect(sent.body.newsletter.status).toBe('sent');
    expect(sent.body.newsletter.sent_by).toBe(me);
    // Two subscribed, one opted out.
    expect(sent.body.newsletter.recipient_count).toBe(2);

    const again = await callJson<{ error: string }>(`/api/newsletters/${id}/sent`, {
      method: 'POST',
      cookie,
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already_sent');

    // Reopening it as a draft clears the stamps, so no row claims both.
    const reopened = await callJson<{ newsletter: Newsletter }>(
      `/api/newsletters/${id}`,
      { method: 'PATCH', cookie, body: JSON.stringify({ status: 'draft' }) },
    );
    expect(reopened.body.newsletter.sent_at).toBeNull();
    expect(reopened.body.newsletter.recipient_count).toBeNull();
  });

  it('reports the live subscriber count beside the list', async () => {
    const cookie = await signUpCoach(7224);
    await makeContact(cookie, { email: 'a@example.test' });
    await makeContact(cookie, { email: 'b@example.test' });
    await makeNewsletter(cookie);

    const list = await callJson<{ subscriber_count: number }>('/api/newsletters', {
      cookie,
    });
    expect(list.body.subscriber_count).toBe(2);
  });
});

// ---------------------------------------------------------------- permissions

describe('visibility and permissions', () => {
  it('lets every role read and only non-viewers write', async () => {
    const coach = await signUpCoach(7230);
    const { cookie: student } = await inviteAndAccept(coach, {
      role: 'student',
      handle: 'news-student',
    });
    const { cookie: viewer } = await inviteAndAccept(coach, {
      role: 'viewer',
      handle: 'news-viewer',
    });
    await makeContact(coach);
    const id = (await makeNewsletter(coach)).body.newsletter.id;

    for (const cookie of [student, viewer]) {
      expect((await callJson('/api/contacts', { cookie })).status).toBe(200);
      expect((await callJson('/api/newsletters', { cookie })).status).toBe(200);
      expect((await callJson(`/api/newsletters/${id}`, { cookie })).status).toBe(200);
    }

    // Students write the updates — that is the point.
    const studentDraft = await makeNewsletter(student, { title: 'From the students' });
    expect(studentDraft.status).toBe(201);
    expect(
      (await callJson(`/api/newsletters/${studentDraft.body.newsletter.id}/body`, {
        method: 'PUT',
        cookie: student,
        body: JSON.stringify({ content: bodyDoc('We built an intake.') }),
      })).status,
    ).toBe(200);
    expect((await makeContact(student, { email: 'student-added@example.test' })).status).toBe(
      201,
    );

    // Viewers write nothing.
    expect((await makeNewsletter(viewer, { title: 'Nope' })).status).toBe(403);
    expect((await makeContact(viewer, { email: 'nope@example.test' })).status).toBe(403);
    expect(
      (await callJson(`/api/newsletters/${id}/sent`, { method: 'POST', cookie: viewer }))
        .status,
    ).toBe(403);
  });

  it("answers 404 for another team's rows", async () => {
    const cookieA = await signUpCoach(7231);
    const cookieB = await signUpCoach(7232);
    const contact = (await makeContact(cookieA)).body.contact;
    const newsletter = (await makeNewsletter(cookieA)).body.newsletter;

    for (const [path, init] of [
      [`/api/contacts/${contact.id}`, { method: 'PATCH', body: JSON.stringify({ note: 'x' }) }],
      [
        `/api/contacts/${contact.id}/subscription`,
        { method: 'POST', body: JSON.stringify({ subscribed: false }) },
      ],
      [`/api/contacts/${contact.id}`, { method: 'DELETE' }],
      [`/api/newsletters/${newsletter.id}`, {}],
      [
        `/api/newsletters/${newsletter.id}`,
        { method: 'PATCH', body: JSON.stringify({ title: 'Mine now' }) },
      ],
      [
        `/api/newsletters/${newsletter.id}/body`,
        { method: 'PUT', body: JSON.stringify({ content: bodyDoc('theirs') }) },
      ],
      [`/api/newsletters/${newsletter.id}/sent`, { method: 'POST' }],
      [`/api/newsletters/${newsletter.id}`, { method: 'DELETE' }],
    ] as const) {
      const response = await callJson(path, {
        ...(init as Record<string, unknown>),
        cookie: cookieB,
      });
      expect(response.status).toBe(404);
    }
  });

  it('keeps one team\'s contacts out of another\'s list', async () => {
    const cookieA = await signUpCoach(7233);
    const cookieB = await signUpCoach(7234);
    await makeContact(cookieA, { email: 'shared@example.test' });

    const theirs = await callJson<{ contacts: Contact[] }>('/api/contacts', {
      cookie: cookieB,
    });
    expect(theirs.body.contacts).toHaveLength(0);

    // The same address on another team is a different contact, not a duplicate.
    expect((await makeContact(cookieB, { email: 'shared@example.test' })).status).toBe(201);
  });
});

// ------------------------------------------------------------------- integrity

describe('no background sender exists', () => {
  it('has no code path that writes sent_at without a request', async () => {
    const cookie = await signUpCoach(7240);
    const id = (await makeNewsletter(cookie)).body.newsletter.id;
    await callJson(`/api/newsletters/${id}`, {
      method: 'PATCH',
      cookie,
      body: JSON.stringify({ status: 'scheduled', scheduled_for: 1 }),
    });

    // The scheduled cron is worker/backup.ts, and it must not touch this table.
    // Asserted against D1 directly so the test fails if a job is ever wired in
    // and this row moves without anybody asking it to.
    const row = await env.DB.prepare(
      'SELECT status, sent_at FROM newsletters WHERE id = ?',
    )
      .bind(id)
      .first<{ status: string; sent_at: number | null }>();
    expect(row?.status).toBe('scheduled');
    expect(row?.sent_at).toBeNull();
  });
});
