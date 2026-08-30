/**
 * Alpha season purchases (COG-047).
 *
 * Two public, unauthenticated routes. That is unusual in this codebase — every
 * other route behind /api goes through `requireMember` and resolves a tenant
 * from the session — so the reasons are worth stating:
 *
 *   /checkout  is reachable by a coach who has not signed up yet. Requiring a
 *              session would mean the product could only be sold to people
 *              already inside it, which is backwards.
 *   /webhook   is called by Stripe. There is no session and never will be; the
 *              signature IS the authentication.
 *
 * Because neither can resolve a tenant, NEITHER WRITES A TENANT TABLE. They
 * touch `purchases` and `webhook_events` only, both of which are deliberately
 * outside the team_id scheme. See the header of migrations/0007_purchases.sql
 * for why that is a boundary and not an oversight.
 *
 * These are sales, at a price the customer sets. Access is not gated on them
 * during the alpha (plan §8) and no feature reads these rows — but "not gated"
 * is not "not sold", and nothing in this file should start calling it a
 * donation.
 */
import { Hono } from 'hono';
import { nowSeconds, uuid } from '../lib/crypto';
import { readJson, boundedInt, optionalString } from '../lib/http';
import { currentSeason } from './auth';
import {
  clampAmount,
  getCryptoProvider,
  getStripe,
  markEventProcessed,
  releaseEvent,
  verifyTurnstile,
} from '../lib/billing';
import { sameOriginOnly, type AppEnv } from '../lib/tenancy';

const billing = new Hono<AppEnv>();

/** A roster this product can plausibly belong to. Plan §3: <=15 students plus adults. */
const MAX_SEATS = 60;

/**
 * Create a Stripe Checkout Session for one season, at the price the buyer chose.
 *
 * One-time (`mode: 'payment'`) rather than a subscription, deliberately: the
 * season is the unit everything else in this product is scoped to, and a
 * recurring charge quietly renewing against a school card in June is a support
 * ticket nobody wants to open.
 */
billing.post('/checkout', sameOriginOnly, async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: 'billing_not_configured' }, 503);
  }

  const body = await readJson(c);
  if (!body) return c.json({ error: 'invalid_body' }, 400);

  const seatCount = boundedInt(body.seat_count, 1, MAX_SEATS);
  if (seatCount === null) return c.json({ error: 'invalid_seat_count' }, 400);

  const requested = Number(body.amount_cents);
  if (!Number.isFinite(requested)) return c.json({ error: 'invalid_amount' }, 400);

  // THE line of this file. The browser sends a money amount, so the browser does
  // not get to decide it. Clamped, not rejected — see lib/billing.ts.
  const amountCents = clampAmount(requested);

  const ok = await verifyTurnstile(
    c.env,
    optionalString(body.turnstile_token, 4096),
    c.req.header('CF-Connecting-IP') ?? null,
  );
  if (!ok) return c.json({ error: 'challenge_failed' }, 403);

  // Self-reported. Never joined to `teams` — see the migration header.
  const teamNumber = boundedInt(body.team_number, 1, 99_999_999);
  const teamName = optionalString(body.team_name, 120);

  const now = nowSeconds();
  const season = currentSeason(now);
  const purchaseId = uuid();
  const origin = new URL(c.req.url).origin;

  const stripe = getStripe(c.env);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        // Inline price_data, never a Price id: the amount is the customer's,
        // so there is nothing to look up.
        //
        // The PRODUCT is looked up though, when STRIPE_PRODUCT_ID is set. The
        // `product_data` fallback below works, but Stripe creates a new product
        // for every session that uses it — a season's worth of purchases leaves
        // the catalog full of identical rows and makes revenue-by-product
        // useless. Pointing at one product instead is the difference between a
        // report and a list.
        price_data: {
          currency: 'usd',
          unit_amount: amountCents,
          ...(c.env.STRIPE_PRODUCT_ID
            ? { product: c.env.STRIPE_PRODUCT_ID }
            : { product_data: { name: `Coglin — ${season.label} season` } }),
        },
        quantity: 1,
      },
    ],
    // Set on both the session and the payment intent. The session's metadata is
    // what the webhook reads back; the intent's is what makes a row in the
    // Stripe dashboard legible months later without joining anything to D1.
    metadata: {
      purchase_id: purchaseId,
      season: season.label,
      seat_count: String(seatCount),
      team_number: teamNumber === null ? '' : String(teamNumber),
      team_name: teamName ?? '',
    },
    payment_intent_data: {
      metadata: { purchase_id: purchaseId, season: season.label },
    },
    success_url: `${origin}/pricing?paid=1`,
    cancel_url: `${origin}/pricing`,
  });

  // Written AFTER the session exists, so `stripe_session_id` is never null and
  // the NOT NULL UNIQUE constraint can do its job. A row that fails to insert
  // here costs us a record, not a payment — and Stripe still holds the metadata.
  await c.env.DB.prepare(
    `INSERT INTO purchases
       (id, stripe_session_id, stripe_payment_intent, team_number, team_name,
        seat_count, amount_cents, currency, season_label, status, created_at, paid_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, 'usd', ?, 'pending', ?, NULL)`,
  )
    .bind(
      purchaseId,
      session.id,
      teamNumber,
      teamName,
      seatCount,
      amountCents,
      season.label,
      now,
    )
    .run();

  return c.json({ url: session.url, amount_cents: amountCents });
});

/**
 * Stripe webhook. The only writer of `status` on a purchase.
 *
 * Three things here are easy to get wrong and all three are load-bearing:
 *
 *  1. NO `sameOriginOnly`. Stripe posts from Stripe. Applying the CSRF guard
 *     that every other write in this codebase uses would reject every event.
 *  2. The RAW body, read before anything parses it. Signature verification is
 *     over the exact bytes sent — `c.req.json()` first and the signature can
 *     never match.
 *  3. `constructEventAsync` with the SubtleCrypto provider. The synchronous
 *     variant reaches for node:crypto and throws in this runtime.
 */
billing.post('/webhook', async (c) => {
  if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_WEBHOOK_SECRET) {
    return c.json({ error: 'billing_not_configured' }, 503);
  }

  const signature = c.req.header('stripe-signature');
  if (!signature) return c.json({ error: 'missing_signature' }, 400);

  const raw = await c.req.text();
  const stripe = getStripe(c.env);

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      raw,
      signature,
      c.env.STRIPE_WEBHOOK_SECRET,
      undefined,
      getCryptoProvider(),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: 'invalid_signature', detail: message }, 400);
  }

  // Redeliveries are normal, not exceptional: Stripe retries on any non-2xx and
  // sometimes just sends twice. Claim the event before doing any work.
  const firstTime = await markEventProcessed(c.env, event.id);
  if (!firstTime) return c.json({ ok: true, duplicate: true });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        // `payment_status` matters: a completed session with a delayed payment
        // method is not yet money. Card payments settle immediately, so this is
        // belt-and-braces against ever enabling ACH.
        if (session.payment_status !== 'paid') break;

        const intent =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);

        // Keyed on the session id rather than the metadata's purchase_id:
        // the id we wrote at creation is the one thing Stripe cannot have been
        // confused about, and the UNIQUE index makes this exact.
        await c.env.DB.prepare(
          `UPDATE purchases
              SET status = 'paid', paid_at = ?, stripe_payment_intent = ?
            WHERE stripe_session_id = ?`,
        )
          .bind(nowSeconds(), intent, session.id)
          .run();
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        const intent =
          typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : (charge.payment_intent?.id ?? null);
        if (!intent) break;
        await c.env.DB.prepare(
          `UPDATE purchases SET status = 'refunded' WHERE stripe_payment_intent = ?`,
        )
          .bind(intent)
          .run();
        break;
      }

      default:
        break;
    }
  } catch (err) {
    // Give the claim back so the retry can do this properly. Without it, one
    // transient D1 error strands a real charge as 'pending' permanently.
    await releaseEvent(c.env, event.id);
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: 'handler_failed', detail: message }, 500);
  }

  return c.json({ ok: true });
});

export { billing };
