/**
 * Pay what you think is fair — the alpha's pricing page (COG-047).
 *
 * Moved under `src/marketing/` when the site grew around it; it now renders
 * inside MarketingShell, which owns the header, the footer and the *FIRST*
 * disclaimer this page used to carry itself.
 *
 * Three rules govern the copy, and all three are the kind that quietly erode:
 *
 *  1. THIS IS A PRODUCT BEING SOLD. The customer names the price; that does not
 *     make it a donation, and the words "gift", "donate", "support us" and
 *     "chip in" do not belong on this page. A team that pays $80 for a season
 *     bought a season for $80. Charity framing devalues the thing and insults
 *     the buyer, and it would make the pricing evidence we are collecting
 *     useless — what someone donates says nothing about what they would pay.
 *
 *  2. THE PRICE IS THEIRS BECAUSE THE PRODUCT IS UNFINISHED, not because we are
 *     shy about charging. `coglin-plan.md` §7 carries a working number for the
 *     2027-28 launch, but that is an INTERNAL PLANNING FIGURE and it must not
 *     appear in copy. An earlier version of this page printed it as "it will
 *     list at $149 a season once it is finished", which turned an assumption
 *     into a promise we would then have to honour or publicly walk back. Say
 *     what it costs today, say the rest is undecided, stop there.
 *
 *  3. THE MATRIX DOES NOT LIE ABOUT WHAT SHIPS — see `capabilities.ts`, which is
 *     now the single source for that across the whole site.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { startPurchase } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { PageIntro, Section, Wrap } from './parts';
import { FitMatrix } from './FitMatrix';

/** Mirrors PER_SEAT_CENTS in worker/lib/billing.ts. The server is authoritative. */
const PER_SEAT = 12;
const DEFAULT_SEATS = 12;
const MIN_TOTAL = 5;
const MAX_PER_SEAT = 40;

/**
 * Present only when the deploy was built with one. Must be set in the same
 * breath as the Worker's TURNSTILE_SECRET_KEY: the server rejects a missing
 * token whenever the secret is configured, so one without the other means every
 * checkout fails with `challenge_failed`.
 */
const TURNSTILE_SITE_KEY: string | undefined = import.meta.env
  .VITE_TURNSTILE_SITE_KEY;

const PRESETS = [
  { rate: 6, label: 'Tight budget' },
  { rate: PER_SEAT, label: 'Recommended' },
  { rate: 20, label: "It's earned it" },
] as const;

const MESSAGES: Record<string, string> = {
  billing_not_configured:
    "Checkout isn't switched on yet. Nothing is wrong on your end — try again in a few days.",
  invalid_seat_count: 'That roster size does not look right.',
  invalid_amount: 'That price does not look right.',
  challenge_failed: 'The anti-spam check did not pass. Reload the page and try again.',
};

function dollars(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

export default function Pricing() {
  const [params] = useSearchParams();
  const paid = params.get('paid') === '1';

  const [seats, setSeats] = useState(DEFAULT_SEATS);
  const [rate, setRate] = useState<number>(PER_SEAT);
  const [teamNumber, setTeamNumber] = useState('');
  const [teamName, setTeamName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnstileToken = useRef<string | null>(null);

  const total = useMemo(() => Math.round(seats * rate), [seats, rate]);
  const tooSmall = total < MIN_TOTAL;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { url } = await startPurchase({
        amount_cents: total * 100,
        seat_count: seats,
        team_number: teamNumber ? Number(teamNumber) : undefined,
        team_name: teamName || undefined,
        turnstile_token: turnstileToken.current ?? undefined,
      });
      window.location.href = url;
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(MESSAGES[code] ?? 'Something went wrong. Try again in a moment.');
      setPending(false);
    }
  }

  if (paid) return <Receipt />;

  return (
    <>
      <PageIntro
        eyebrow="Pricing"
        title="Pay what you think is fair"
        lede={
          <>
            <strong className="text-foreground font-semibold">
              Coglin costs money. During the alpha, you decide how much.
            </strong>{' '}
            We recommend {dollars(PER_SEAT)} per seat for the season. Pay more if
            it is worth more to you, less if your budget says so. Either way you
            are buying a season of software, at a price you set.
          </>
        }
      />

      <Wrap className="pb-4">
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          The award tracker and the outreach rollups aren't built yet, and the
          table below is specific about what is and isn't. Until that gap closes,
          the teams actually running a season on this have a better idea what it
          is worth than we do, so we would rather you set the number. What Coglin
          costs after the alpha hasn't been decided, and whatever we land on will
          not be applied backwards to anyone who paid during it.
        </p>
      </Wrap>

      <Wrap className="py-8">
        <form onSubmit={onSubmit} className="max-w-xl space-y-8">
          {/* Asked rather than read: this page has no session, so there is no
              roster to look up — and a coach knows the number. */}
          <section className="space-y-2">
            <Label htmlFor="seats">How many people are on your team?</Label>
            <Input
              id="seats"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              value={seats}
              onChange={(e) =>
                setSeats(Math.max(1, Math.min(60, Number(e.target.value) || 1)))
              }
              className="max-w-28"
            />
            <p className="text-muted-foreground text-xs">
              Students, coaches and mentors — everyone who would have an account.
            </p>
          </section>

          <section className="space-y-4">
            <Label htmlFor="rate">What is a season of this worth, per seat?</Label>

            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.rate}
                  type="button"
                  onClick={() => setRate(p.rate)}
                  aria-pressed={rate === p.rate}
                  // `text-foreground` is load-bearing, not decoration. A bare
                  // <button> with no colour set falls through to the UA's
                  // `buttontext` system colour, which Tailwind v4's preflight
                  // does not reset — so these read near-black on the graphite
                  // background in dark mode (1.18:1, effectively invisible)
                  // while every sibling element inherits correctly. Custom
                  // controls state their own colour.
                  className={cn(
                    'text-foreground rounded-md border px-3 py-2 text-left text-sm transition-colors',
                    rate === p.rate
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-accent',
                  )}
                >
                  <span className="tabular font-mono font-semibold">${p.rate}</span>
                  <span className="text-muted-foreground ml-2 text-xs">{p.label}</span>
                </button>
              ))}
            </div>

            <input
              id="rate"
              type="range"
              min={0}
              max={MAX_PER_SEAT}
              step={1}
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
              aria-label="Dollars per seat per season"
              className="accent-primary w-full"
            />

            <div className="border-border flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-dashed p-4">
              <span className="u-display tabular text-heading font-mono text-3xl leading-none">
                {dollars(total)}
              </span>
              <span className="text-muted-foreground text-sm">
                for the whole season — {seats} {seats === 1 ? 'seat' : 'seats'} &times;{' '}
                {dollars(rate)} each
              </span>
            </div>

            {tooSmall && (
              <p className="text-muted-foreground text-sm leading-relaxed">
                Card payments below {dollars(MIN_TOTAL)} cost more to process than they
                are worth, so this cannot go through. If Coglin is not worth paying for
                yet, that is a real answer — tell us why and keep using it.
              </p>
            )}
          </section>

          {/* Optional, and honestly labelled as unverified. The server never
              joins these to a real team. */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="team_number">Team number</Label>
              <Input
                id="team_number"
                type="number"
                inputMode="numeric"
                value={teamNumber}
                onChange={(e) => setTeamNumber(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team_name">Team name</Label>
              <Input
                id="team_name"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <p className="text-muted-foreground text-xs sm:col-span-2">
              So we can match the payment to your team. Neither is checked against
              anything.
            </p>
          </section>

          <Turnstile onToken={(t) => (turnstileToken.current = t)} />

          <div>
            <Button type="submit" className="w-full" disabled={pending || tooSmall}>
              {pending ? 'Opening checkout…' : `Pay ${dollars(total)} for the season`}
            </Button>
            <p className="text-muted-foreground mt-2 text-center text-xs">
              One payment for the {seasonLabel()} season. Not a subscription, and
              nothing renews. Card details go straight to Stripe — they never touch
              Coglin.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </form>
      </Wrap>

      <Section title="Why not just use Trello?">
        <p className="text-muted-foreground mb-5 max-w-2xl text-sm leading-relaxed">
          You can, and plenty of teams do — general project tools handle boards
          perfectly well, and the table says so. What they cannot do is know what a
          judge is going to ask for in March. That is what you are paying for.
        </p>
        <FitMatrix />
      </Section>

      <Wrap className="pb-4">
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          A school that can only pay by purchase order?{' '}
          <a
            className="text-foreground underline underline-offset-4"
            href="mailto:admin@lilithforge.com?subject=Coglin%20purchase%20order"
          >
            admin@lilithforge.com
          </a>{' '}
          and we will invoice you.
        </p>
      </Wrap>
    </>
  );
}

/**
 * The season this purchase is for. Duplicated from the server's currentSeason()
 * rather than fetched — it is one line of arithmetic used for a label, and a
 * round trip to render static copy is not worth it. The server computes the
 * authoritative value for the row it writes.
 */
function seasonLabel(): string {
  const d = new Date();
  const start = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Cloudflare Turnstile, guarding the one public endpoint that creates Stripe
 * sessions.
 *
 * Renders nothing when no site key was built in, which is the correct local-dev
 * state and matches the server, where an unset TURNSTILE_SECRET_KEY skips
 * verification. The two settings are a pair — see the note on TURNSTILE_SITE_KEY
 * above.
 *
 * The script is loaded here rather than from index.html so a deploy without
 * Turnstile does not pay for a third-party request on every page of the app.
 */
function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !host.current) return;
    const el = host.current;

    function render() {
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (!api) return;
      api.render(el, {
        sitekey: TURNSTILE_SITE_KEY!,
        callback: onToken,
        // A token is single-use and expires. Clearing it on both paths means a
        // stale token is never sent — the server would reject it and the buyer
        // would see a challenge failure they cannot act on.
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      });
    }

    if ((window as unknown as { turnstile?: TurnstileApi }).turnstile) {
      render();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [onToken]);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={host} />;
}

interface TurnstileApi {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ) => void;
}

function Receipt() {
  return (
    <Wrap className="py-16">
      <div className="max-w-md">
        <h1 className="u-display text-2xl leading-tight">
          You're paid up for the season.
        </h1>
        <p className="mt-4 text-sm leading-relaxed">
          Stripe has emailed your receipt. Nothing about your account changed,
          because nothing needed to — you already had everything, and you still do
          if you ever want a refund.
        </p>
        <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
          You bought an unfinished product on purpose, so hold us to it: tell us what
          your team fought with this week at{' '}
          <a
            className="text-foreground underline underline-offset-4"
            href="mailto:admin@lilithforge.com?subject=Coglin%20feedback"
          >
            admin@lilithforge.com
          </a>
          .
        </p>
        <Button asChild className="mt-8">
          <Link to="/app">Open Coglin</Link>
        </Button>
      </div>
    </Wrap>
  );
}
