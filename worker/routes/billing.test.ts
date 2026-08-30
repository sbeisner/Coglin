import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import worker from '../index';
import { ORIGIN, call, callJson, stripeSignature, stubStripe } from './_helpers';
import { MAX_CENTS, MIN_CENTS, recommendedCents } from '../lib/billing';

/**
 * Alpha season purchases (COG-047).
 *
 * Two properties carry the weight here, and neither is about the happy path:
 *
 *   THE PRICE IS THE CUSTOMER'S TO SET, WITHIN BOUNDS. /checkout is public and
 *   unauthenticated, so `amount_cents` arrives from a stranger. The assertions
 *   below check the number that reached STRIPE, not the one we returned — an
 *   echo would pass while a $0.01 session was created.
 *
 *   THE WEBHOOK IS SAFE TO RUN TWICE. Stripe redelivers on any non-2xx and
 *   sometimes just does. A second delivery must not double-count a sale.
 *
 * These routes touch no tenant table, so unlike every other suite in this
 * directory there is no coach to sign up and no team number to reserve.
 */

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

function checkout(body: Record<string, unknown>) {
  return callJson<{ url?: string; amount_cents?: number; error?: string }>(
    '/api/billing/checkout',
    { method: 'POST', body: JSON.stringify(body) },
  );
}

async function sendWebhook(
  event: Record<string, unknown>,
  opts: { secret?: string } = {},
): Promise<Response> {
  const payload = JSON.stringify(event);
  const signature = await stripeSignature(
    payload,
    opts.secret ?? env.STRIPE_WEBHOOK_SECRET!,
  );
  return call('/api/billing/webhook', {
    method: 'POST',
    body: payload,
    headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
  });
}

function completedEvent(id: string, sessionId: string, intent = 'pi_test_1') {
  return {
    id,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        payment_status: 'paid',
        payment_intent: intent,
      },
    },
  };
}

async function row(sessionId: string) {
  return env.DB.prepare('SELECT * FROM purchases WHERE stripe_session_id = ?')
    .bind(sessionId)
    .first<{ status: string; amount_cents: number; paid_at: number | null }>();
}

describe('the recommendation', () => {
  it('puts a 12-seat roster on the plan’s list price', () => {
    // $12 x 12 = $144, against the $149 that coglin-plan.md §7 sets for the
    // 2027-28 paid launch. If this drifts, the alpha stops telling us anything
    // useful about what teams will actually pay.
    expect(recommendedCents(12)).toBe(14_400);
  });
});

describe('POST /api/billing/checkout', () => {
  it('creates a session at the requested amount', async () => {
    const stripe = stubStripe('cs_ok');
    restore = stripe.restore;

    const { status, body } = await checkout({ amount_cents: 14_400, seat_count: 12 });

    expect(status).toBe(200);
    expect(body.url).toContain('checkout.stripe.com');
    expect(stripe.requests[0].get('line_items[0][price_data][unit_amount]')).toBe(
      '14400',
    );
    expect(stripe.requests[0].get('mode')).toBe('payment');
    expect((await row('cs_ok'))?.status).toBe('pending');
  });

  it('clamps an amount below the floor', async () => {
    const stripe = stubStripe('cs_low');
    restore = stripe.restore;

    const { body } = await checkout({ amount_cents: 1, seat_count: 12 });

    expect(body.amount_cents).toBe(MIN_CENTS);
    expect(stripe.requests[0].get('line_items[0][price_data][unit_amount]')).toBe(
      String(MIN_CENTS),
    );
    expect((await row('cs_low'))?.amount_cents).toBe(MIN_CENTS);
  });

  it('clamps an amount above the ceiling', async () => {
    const stripe = stubStripe('cs_high');
    restore = stripe.restore;

    const { body } = await checkout({ amount_cents: 99_999_999, seat_count: 12 });

    expect(body.amount_cents).toBe(MAX_CENTS);
    expect(stripe.requests[0].get('line_items[0][price_data][unit_amount]')).toBe(
      String(MAX_CENTS),
    );
  });

  it('rejects an implausible roster', async () => {
    const stripe = stubStripe('cs_never');
    restore = stripe.restore;

    expect((await checkout({ amount_cents: 1000, seat_count: 0 })).status).toBe(400);
    expect((await checkout({ amount_cents: 1000, seat_count: 5000 })).status).toBe(400);
    expect(stripe.requests).toHaveLength(0);
  });

  /**
   * The site key and the secret key are a PAIR. The server rejects a missing
   * token whenever the secret is set, and the page only sends one when
   * VITE_TURNSTILE_SITE_KEY was built into the bundle — so configuring the
   * secret alone takes every checkout down with `challenge_failed`, on a page
   * that otherwise looks fine. This test is the reminder.
   */
  it('rejects a checkout with no token once Turnstile is configured', async () => {
    const stripe = stubStripe('cs_turnstile');
    restore = () => {
      stripe.restore();
      delete (env as { TURNSTILE_SECRET_KEY?: string }).TURNSTILE_SECRET_KEY;
    };
    (env as { TURNSTILE_SECRET_KEY?: string }).TURNSTILE_SECRET_KEY = '0x_test';

    const { status, body } = await checkout({ amount_cents: 14_400, seat_count: 12 });

    expect(status).toBe(403);
    expect(body.error).toBe('challenge_failed');
    expect(stripe.requests).toHaveLength(0);
  });

  // Built by hand rather than through call(), which forces the good Origin on
  // every request so that the other suites are testing handlers instead of the
  // CSRF guard. This is the one test that needs the guard to see a bad one.
  it('refuses a cross-origin post', async () => {
    const stripe = stubStripe('cs_csrf');
    restore = stripe.restore;

    const request = new Request(`${ORIGIN}/api/billing/checkout`, {
      method: 'POST',
      body: JSON.stringify({ amount_cents: 14_400, seat_count: 12 }),
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(403);
    expect(stripe.requests).toHaveLength(0);
  });
});

describe('POST /api/billing/webhook', () => {
  it('marks a purchase paid', async () => {
    const stripe = stubStripe('cs_paid');
    restore = stripe.restore;
    await checkout({ amount_cents: 14_400, seat_count: 12 });

    const response = await sendWebhook(completedEvent('evt_paid', 'cs_paid'));

    expect(response.status).toBe(200);
    const saved = await row('cs_paid');
    expect(saved?.status).toBe('paid');
    expect(saved?.paid_at).toBeGreaterThan(0);
  });

  it('is idempotent across a redelivery', async () => {
    const stripe = stubStripe('cs_dupe');
    restore = stripe.restore;
    await checkout({ amount_cents: 14_400, seat_count: 12 });

    const event = completedEvent('evt_dupe', 'cs_dupe');
    expect((await sendWebhook(event)).status).toBe(200);

    const second = await sendWebhook(event);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });

    const { results } = await env.DB.prepare(
      "SELECT id FROM purchases WHERE stripe_session_id = ? AND status = 'paid'",
    )
      .bind('cs_dupe')
      .all();
    expect(results).toHaveLength(1);
  });

  it('rejects a forged signature and changes nothing', async () => {
    const stripe = stubStripe('cs_forged');
    restore = stripe.restore;
    await checkout({ amount_cents: 14_400, seat_count: 12 });

    const response = await sendWebhook(completedEvent('evt_forged', 'cs_forged'), {
      secret: 'whsec_wrong',
    });

    expect(response.status).toBe(400);
    expect((await row('cs_forged'))?.status).toBe('pending');
  });

  it('rejects a missing signature', async () => {
    const response = await call('/api/billing/webhook', {
      method: 'POST',
      body: JSON.stringify(completedEvent('evt_nosig', 'cs_nosig')),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(400);
  });

  it('ignores a completed session that has not actually paid', async () => {
    const stripe = stubStripe('cs_unpaid');
    restore = stripe.restore;
    await checkout({ amount_cents: 14_400, seat_count: 12 });

    const event = completedEvent('evt_unpaid', 'cs_unpaid');
    (event.data.object as { payment_status: string }).payment_status = 'unpaid';

    expect((await sendWebhook(event)).status).toBe(200);
    expect((await row('cs_unpaid'))?.status).toBe('pending');
  });

  it('marks a refund', async () => {
    const stripe = stubStripe('cs_refund');
    restore = stripe.restore;
    await checkout({ amount_cents: 14_400, seat_count: 12 });
    await sendWebhook(completedEvent('evt_r1', 'cs_refund', 'pi_refund'));

    const response = await sendWebhook({
      id: 'evt_r2',
      object: 'event',
      type: 'charge.refunded',
      data: { object: { object: 'charge', payment_intent: 'pi_refund' } },
    });

    expect(response.status).toBe(200);
    expect((await row('cs_refund'))?.status).toBe('refunded');
  });
});
