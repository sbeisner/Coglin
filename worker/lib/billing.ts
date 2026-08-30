/**
 * Stripe plumbing for the alpha's pay-what-you-think-is-fair pricing (COG-047).
 *
 * A near-straight port of `website/inkubus/functions/_lib/stripe.js`, which has
 * been taking real money since July. Two details there are not stylistic and are
 * repeated here for the same reasons:
 *
 *   - `createFetchHttpClient()` — the SDK defaults to Node's `http` module,
 *     which does not exist in the Workers runtime.
 *   - `createSubtleCryptoProvider()` — webhook signature verification must go
 *     through the ASYNC `constructEventAsync`. The synchronous `constructEvent`
 *     calls into node:crypto and throws here.
 *
 * What is NOT ported: Inkubus's `priceToTier` / `tierToPrice`. There is no Price
 * object at all in this flow. The amount is set by the customer and passed
 * inline as `price_data.unit_amount`, because a page where the buyer names the
 * price has no fixed price to look up. It is still a sale — see the header of
 * migrations/0007_purchases.sql.
 */
import Stripe from 'stripe';
import type { Bindings } from '../types';

export function getStripe(env: Bindings): Stripe {
  // Non-null asserted: every caller has already refused the request when the key
  // is unset (see routes/billing.ts), so reaching here without one is a bug, not
  // a configuration state to handle twice.
  return new Stripe(env.STRIPE_SECRET_KEY!, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export function getCryptoProvider(): Stripe.CryptoProvider {
  return Stripe.createSubtleCryptoProvider();
}

// ------------------------------------------------------------------- amounts

/**
 * The recommended price, in cents per seat per season.
 *
 * $12 x a 12-seat roster is $144, which sits near the working figure
 * `coglin-plan.md` §7 carries for the 2027-28 launch. Anchoring here means what
 * teams choose is useful pricing evidence rather than a number floating free of
 * anything.
 *
 * THAT PLANNED FIGURE IS INTERNAL AND MUST NOT APPEAR IN COPY. The pricing page
 * printed it once as "it will list at $149 a season", which converted a working
 * assumption into a public commitment. Post-alpha pricing is undecided and the
 * site says so. See the header of src/marketing/Faq.tsx.
 *
 * Note this is a per-SEAT recommendation, while §7's eventual list price is flat
 * per-team. That is a deliberate difference, not drift: a per-seat figure is how
 * a coach can size the number against a roster they already know, and the alpha
 * is where we find out whether teams agree with it.
 */
export const PER_SEAT_CENTS = 1200;

/** Default roster size on the page. Plan §3 puts a team at <=15 students plus adults. */
export const DEFAULT_SEAT_COUNT = 12;

/**
 * Stripe will not process trivial amounts, and a card-testing script would love
 * an endpoint that creates unlimited $0.50 sessions. $5 is the floor.
 *
 * A team that decides the alpha is not worth paying for yet simply does not
 * check out; that is a legitimate answer to "what is this worth", and it is one
 * the slider can express without a Checkout Session behind it.
 */
export const MIN_CENTS = 500;

/**
 * $2,000. A limit on a fat finger and on anyone hoping to launder a large charge
 * through a public endpoint, not a ceiling on what anyone may pay — a club
 * buying for four teams can email admin@lilithforge.com and be invoiced.
 */
export const MAX_CENTS = 200_000;

/**
 * Clamp rather than reject.
 *
 * The client sends a money amount, so this value is never trusted — but an
 * out-of-range number is far more likely to be our own slider misbehaving than
 * an attack, and refusing outright would turn a UI bug into a lost sale.
 * Clamping is silent on purpose: the amount the customer actually confirms is
 * the one Stripe shows them on the hosted page, not one we echoed back.
 */
export function clampAmount(cents: number): number {
  if (!Number.isFinite(cents)) return MIN_CENTS;
  return Math.min(MAX_CENTS, Math.max(MIN_CENTS, Math.round(cents)));
}

/** The page's recommended total for a roster of `seats`. */
export function recommendedCents(seats: number): number {
  return clampAmount(seats * PER_SEAT_CENTS);
}

// -------------------------------------------------------------- idempotency

/**
 * Record that we have handled this provider event. Returns true the FIRST time
 * and false for a redelivery.
 *
 * D1's `run()` reports `meta.changes`, so `INSERT OR IGNORE` doubles as the
 * check and the claim in one statement — there is no read-then-write window for
 * two concurrent redeliveries to race through. Lifted verbatim in behaviour from
 * `website/inkubus/functions/_lib/db.js`.
 */
export async function markEventProcessed(
  env: Bindings,
  eventId: string,
  source = 'stripe',
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    'INSERT OR IGNORE INTO webhook_events (id, source, processed_at) VALUES (?, ?, ?)',
  )
    .bind(eventId, source, now)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Release the idempotency claim so Stripe's retry can reprocess.
 *
 * Called only when the handler threw AFTER claiming the event. Without it a
 * transient D1 failure would be permanent: Stripe retries, `markEventProcessed`
 * says "already done", and the purchase stays 'pending' forever with a real
 * charge behind it.
 */
export async function releaseEvent(env: Bindings, eventId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM webhook_events WHERE id = ?').bind(eventId).run();
}

// ---------------------------------------------------------------- turnstile

/**
 * Verify a Cloudflare Turnstile token, if Turnstile is configured.
 *
 * Unset secret means "not enabled", not "deny everything" — the same call this
 * codebase already makes for RESEND_API_KEY (worker/types.ts). Local dev and a
 * half-configured staging deploy should still be able to take a test payment;
 * the server-side clamp and the WAF rate-limit rule are the controls that do not
 * depend on configuration being complete.
 *
 * SETTING THE SECRET IS HALF THE JOB. The page only sends a token when
 * VITE_TURNSTILE_SITE_KEY is built into the bundle, so a deploy with the secret
 * set and the site key missing rejects every checkout with `challenge_failed`.
 * Both or neither — docs/COGLIN-STRIPE-RUNBOOK.md says so too.
 */
export async function verifyTurnstile(
  env: Bindings,
  token: string | null,
  ip: string | null,
): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  try {
    const response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: form },
    );
    const body = (await response.json()) as { success?: boolean };
    return body.success === true;
  } catch {
    // A Turnstile outage should not stop a team buying the product.
    return true;
  }
}
