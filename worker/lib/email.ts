/**
 * Outbound mail (COG-041, invite slice).
 *
 * One rule governs this file: the recipient address is a parameter and never
 * becomes state. It arrives from the coach's form, goes out over the wire, and
 * goes out of scope. It is not returned, not stored, and not logged — including
 * in the error path, which is the easy place to leak it by reflex. See the
 * header of `migrations/0002_invites.sql` for why.
 *
 * Transport is **Resend**, not Cloudflare Email Sending. lilithforge.com has
 * been sending transactional mail through Resend since the Inkubus work —
 * `resend._domainkey.lilithforge.com` is live, and website/docs/EMAIL-RUNBOOK.md
 * documents the split deliberately: Zoho owns the human mailbox at admin@, and
 * Resend owns app mail, coexisting on separate DKIM selectors. Email Sending
 * would have meant onboarding a new sending domain and a Workers Paid plan to
 * obtain a capability this domain already has.
 *
 * The API key is shared with Inkubus. Worth knowing when it is next rotated:
 * rolling it for an Inkubus incident stops Coglin invites at the same moment.
 */
import type { Bindings } from '../types';

const ENDPOINT = 'https://api.resend.com/emails';

/**
 * Resend takes `Name <address>` in one string. Sending as admin@ rather than a
 * no-reply has a real benefit here: replies land in the Zoho mailbox, so a
 * parent who hits Reply on their child's invite reaches a person.
 */
const FROM = 'Coglin <admin@lilithforge.com>';

export interface InviteMail {
  /** Recipient. Transient — see the file header. */
  to: string;
  inviterName: string;
  teamNumber: number;
  teamName: string;
  displayName: string;
  url: string;
  expiresInDays: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Deliberately plain. This mail lands in the inbox of a 14-year-old and, often,
 * their parent, and it asks them to click a link and set a password — which is
 * the exact shape of a phishing email. Naming the inviter, the team, and the
 * expiry, with no images or tracking pixels and one obvious link, is what makes
 * it read as legitimate.
 */
function render(mail: InviteMail): { subject: string; html: string; text: string } {
  const team = `${mail.teamNumber} ${mail.teamName}`;
  const subject = `${mail.inviterName} has invited you to join ${team}`;
  const safeUrl = escapeHtml(mail.url);

  const text = [
    `${mail.inviterName} has invited you to join ${team} on Coglin.`,
    '',
    'Coglin is where the team keeps its boards, roster, and outreach log for the season.',
    '',
    `Open this link to choose your username and password:`,
    mail.url,
    '',
    `The link works once and expires in ${mail.expiresInDays} days.`,
    '',
    "If you weren't expecting this, you can ignore this email.",
    '',
    'Coglin is not affiliated with or endorsed by FIRST®.',
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f7f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16201a;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
      <p style="margin:0 0 16px;font-size:18px;line-height:1.5;">
        <strong>${escapeHtml(mail.inviterName)}</strong> has invited you to join
        <strong>${escapeHtml(team)}</strong> on Coglin.
      </p>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4e5a52;">
        Coglin is where the team keeps its boards, roster, and outreach log for
        the season. Open the link below to choose your username and password.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${safeUrl}" style="display:inline-block;background:#4fce74;color:#05190d;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;">
          Set up your account
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6f7a72;">
        Or paste this into your browser:<br />
        <span style="word-break:break-all;">${safeUrl}</span>
      </p>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6f7a72;">
        The link works once and expires in ${mail.expiresInDays} days. If you
        weren't expecting this, you can ignore this email.
      </p>
      <p style="margin:24px 0 0;font-size:12px;color:#9aa39c;">
        Coglin is not affiliated with or endorsed by FIRST®.
      </p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

/**
 * Returns whether the send succeeded rather than throwing, because the invite
 * row is already committed by this point and the coach still has the copyable
 * link. A failed send is a degraded result, not a failed operation.
 */
export async function sendInvite(
  env: Bindings,
  mail: InviteMail,
): Promise<boolean> {
  // No key configured is a normal state in local dev, not an error. The invite
  // still exists and the dialog still shows a working link.
  if (!env.RESEND_API_KEY) return false;

  const { subject, html, text } = render(mail);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: [mail.to], subject, html, text }),
    });

    // fetch does not throw on 4xx/5xx. Without this check every send would
    // report success, including a rejected address or a revoked key — and the
    // coach would be told the mail is on its way when nothing was sent.
    if (!response.ok) {
      // Status only. Resend's error bodies quote the recipient back, and a log
      // line is exactly the durable place this address must never reach.
      console.error(`invite email rejected by Resend: HTTP ${response.status}`);
      return false;
    }
    return true;
  } catch (err) {
    // Network-level failure. Same rule — the failure class, never the address.
    console.error(
      'invite email send failed:',
      err instanceof Error ? err.name : 'unknown',
    );
    return false;
  }
}

/**
 * Operator alert: a new team just signed up (COG-041, alert slice).
 *
 * This one is the mirror image of the invite above. The invite goes OUT to a
 * person we must not remember; this goes IN to us, and its recipient is
 * `SIGNUP_ALERT_TO` — our own address, fixed in config, never derived from
 * request input. That distinction is what makes it safe to name the new coach's
 * email in the body: they are an adult account holder (`users.is_minor = 0`),
 * the address is going to the mailbox that already owns the relationship, and
 * nothing here writes it to a log. The COPPA rule in the file header is about
 * student recipients and still holds everywhere it applies.
 *
 * Unset `SIGNUP_ALERT_TO` means no alert, which is the correct behaviour in
 * local dev and in tests: signing up is not supposed to mail a real person
 * every time someone runs the suite.
 */
export interface SignupAlertMail {
  teamNumber: number;
  teamName: string;
  region: string | null;
  coachName: string;
  /** The new coach's address. Body content, not the recipient — see above. */
  coachEmail: string;
  seasonLabel: string;
  environment: string;
  /** Unix seconds, rendered as UTC. */
  at: number;
}

function renderSignupAlert(mail: SignupAlertMail): {
  subject: string;
  html: string;
  text: string;
} {
  const team = `${mail.teamNumber} ${mail.teamName}`;
  // The environment is in the subject so a staging smoke test is never mistaken
  // for a real sale sitting in the inbox.
  const tag = mail.environment === 'production' ? '' : `[${mail.environment}] `;
  const subject = `${tag}New Coglin team: ${team}`;

  const rows: [string, string][] = [
    ['Team', team],
    ['Region', mail.region || '—'],
    ['Coach', mail.coachName],
    ['Email', mail.coachEmail],
    ['Season', mail.seasonLabel],
    ['Signed up', `${new Date(mail.at * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC`],
    ['Environment', mail.environment],
  ];

  const text = [`${team} just signed up for Coglin.`, '']
    .concat(rows.map(([label, value]) => `${label}: ${value}`))
    .join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f7f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16201a;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
      <p style="margin:0 0 20px;font-size:18px;line-height:1.5;">
        <strong>${escapeHtml(team)}</strong> just signed up for Coglin.
      </p>
      <table style="border-collapse:collapse;font-size:15px;line-height:1.6;">
        ${rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding:2px 16px 2px 0;color:#6f7a72;">${escapeHtml(label)}</td><td style="padding:2px 0;">${escapeHtml(value)}</td></tr>`,
          )
          .join('\n        ')}
      </table>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

/**
 * Fire-and-forget from the signup handler's `waitUntil`. Returns a boolean for
 * the same reason `sendInvite` does — the team already exists by the time this
 * runs, so a failed alert is something we notice by its absence, never
 * something that costs a coach their account.
 */
export async function sendSignupAlert(
  env: Bindings,
  mail: SignupAlertMail,
): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.SIGNUP_ALERT_TO) return false;

  // Comma-separated so a second pair of eyes can be added without a code change.
  const to = env.SIGNUP_ALERT_TO.split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  if (to.length === 0) return false;

  const { subject, html, text } = renderSignupAlert(mail);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to, subject, html, text }),
    });
    if (!response.ok) {
      console.error(`signup alert rejected by Resend: HTTP ${response.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      'signup alert send failed:',
      err instanceof Error ? err.name : 'unknown',
    );
    return false;
  }
}

/**
 * Operator alert: someone reported a bug from inside the app (COG-0xx).
 *
 * Third mail in this file and the second of the inbound kind, so the rule from
 * `sendSignupAlert` carries over unchanged: the recipient is `BUG_ALERT_TO`,
 * our own address from config, never anything a request can influence.
 *
 * What is different here is the BODY. `mail.body` is free text typed by a user
 * who may well be fourteen, and the failure paths below log a status code and
 * an error name and nothing else — the same reflex `sendInvite` applies to the
 * recipient address, applied to the content instead. A log line is a durable
 * place, and a minor's writing does not belong in one.
 *
 * Unset `BUG_ALERT_TO` returns false, and the caller has already committed the
 * row by then. That is the whole point of the ordering: no mail is a degraded
 * result, never a lost report.
 */
export interface BugReportMail {
  /** Row id, quoted in the mail so triage can act without a lookup. */
  id: string;
  kind: 'bug' | 'confusing' | 'idea';
  /** What the reporter typed. Never logged — see above. */
  body: string;
  reporterName: string;
  role: string;
  teamNumber: number;
  teamName: string;
  route: string | null;
  appBuild: string | null;
  environment: string;
  userAgent: string | null;
  /** '390x844', or null when the client did not send a usable pair. */
  viewport: string | null;
  /** The whitelisted client_meta, already bounded by the route. */
  meta: Record<string, string>;
  /** Unix seconds, rendered as UTC. */
  at: number;
}

const KIND_LABEL: Record<BugReportMail['kind'], string> = {
  bug: 'bug',
  confusing: 'confusing',
  idea: 'idea',
};

/**
 * Everything needed to act on the report without opening D1.
 *
 * The subject carries a stable `[Coglin bug]` prefix so a mail rule can file
 * these, the environment tag for the same reason `renderSignupAlert` uses one,
 * and the team number plus the first line of the report so a week of these is
 * skimmable from the inbox list rather than one at a time.
 */
function renderBugReport(mail: BugReportMail): {
  subject: string;
  html: string;
  text: string;
} {
  const team = `${mail.teamNumber} ${mail.teamName}`;
  const tag = mail.environment === 'production' ? '' : `[${mail.environment}] `;
  const firstLine = mail.body.split('\n')[0].slice(0, 70);
  const subject = `${tag}[Coglin ${KIND_LABEL[mail.kind]}] ${mail.teamNumber} — ${firstLine}`;

  const rows: [string, string][] = [
    ['Kind', mail.kind],
    ['Team', team],
    ['Reporter', `${mail.reporterName} (${mail.role})`],
    ['Screen', mail.route ?? '—'],
    ['Build', `${mail.appBuild ?? '—'} (${mail.environment})`],
    ['Window', mail.viewport ?? '—'],
    ['Client', mail.userAgent ?? '—'],
    ...Object.entries(mail.meta),
    ['Reported', `${new Date(mail.at * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC`],
    ['Report id', mail.id],
  ];

  const text = [
    `${mail.reporterName} reported a ${mail.kind} on team ${team}.`,
    '',
    mail.body,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f7f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16201a;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
      <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">
        <strong>${escapeHtml(mail.reporterName)}</strong> reported a
        ${escapeHtml(mail.kind)} on <strong>${escapeHtml(team)}</strong>.
      </p>
      <div style="white-space:pre-wrap;background:#f4f7f4;border-radius:8px;padding:16px;font-size:15px;line-height:1.6;margin:0 0 24px;">${escapeHtml(mail.body)}</div>
      <table style="border-collapse:collapse;font-size:13px;line-height:1.6;">
        ${rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding:2px 16px 2px 0;color:#6f7a72;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:2px 0;word-break:break-word;">${escapeHtml(value)}</td></tr>`,
          )
          .join('\n        ')}
      </table>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

/**
 * Same contract as the two above: returns whether the send succeeded, never
 * throws. The row is already committed when this runs, and `bug_reports.emailed`
 * stays 0 on a false so the reports the mail never carried stay findable.
 */
export async function sendBugReport(
  env: Bindings,
  mail: BugReportMail,
): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.BUG_ALERT_TO) return false;

  const to = env.BUG_ALERT_TO.split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  if (to.length === 0) return false;

  const { subject, html, text } = renderBugReport(mail);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to, subject, html, text }),
    });
    if (!response.ok) {
      // Status only. Resend echoes the request back in its error bodies, and
      // this request carries a minor's free text.
      console.error(`bug report rejected by Resend: HTTP ${response.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      'bug report send failed:',
      err instanceof Error ? err.name : 'unknown',
    );
    return false;
  }
}
