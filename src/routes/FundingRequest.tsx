/**
 * The funding request: a printable sheet of approved part orders, grouped by
 * vendor with shipping, for the school front office to grant before the coach
 * places the orders. The arithmetic and the CSV live in lib/fundingRequest.ts;
 * this screen is the paper.
 *
 * The sheet is drawn as paper on screen — white, whatever the theme — because
 * what you see is what prints. Everything that is a control (the ticks, the
 * shipping inputs, the buttons) is `print:hidden`, and each input has a
 * print-only twin showing its value as text. AppShell hides its own chrome
 * for print.
 *
 * Reading this is open to every role, like the order queue it is built from;
 * the Orders tab only OFFERS it to approvers, because they are the ones who
 * take it to the office. Nothing here writes to the server.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import * as api from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { useSession } from '@/lib/session';
import { formatCents, parseDollars } from '@/lib/format';
import {
  fundingRequestCsv,
  fundingTotals,
  groupApprovedByVendor,
  lineTotalCents,
  NO_VENDOR_LABEL,
  type VendorGroup,
} from '@/lib/fundingRequest';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * What the coach typed, remembered per team in this browser: shipping figures
 * by vendor key, and the note. A convenience so a reprint next week does not
 * mean re-entering the numbers — not a record. Storage can be missing or
 * throw (private windows), and the screen works the same without it.
 */
interface Draft {
  shipping: Record<string, string>;
  note: string;
}

function draftKey(teamId: string): string {
  return `coglin:funding-request:${teamId}`;
}

function loadDraft(teamId: string): Draft {
  try {
    const raw = localStorage.getItem(draftKey(teamId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Draft>;
      return {
        shipping:
          parsed.shipping && typeof parsed.shipping === 'object' ? parsed.shipping : {},
        note: typeof parsed.note === 'string' ? parsed.note : '',
      };
    }
  } catch {
    // Unreadable or blocked storage is the same as no draft.
  }
  return { shipping: {}, note: '' };
}

function saveDraft(teamId: string, draft: Draft) {
  try {
    localStorage.setItem(draftKey(teamId), JSON.stringify(draft));
  } catch {
    // See loadDraft.
  }
}

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function FundingRequest() {
  const { team, member } = useSession();
  const orders = useAsync(api.listPartOrders);
  const groups = useMemo(() => groupApprovedByVendor(orders.data ?? []), [orders.data]);

  const [draft, setDraft] = useState<Draft>(() => loadDraft(team.id));
  useEffect(() => saveDraft(team.id, draft), [team.id, draft]);

  // Everything approved starts ticked: the usual ask is "all of it". Ids that
  // come back from a later load are ticked too, so this is the EXCLUDED set.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const included = useMemo(() => {
    const ids = new Set<string>();
    for (const g of groups)
      for (const o of g.orders) if (!excluded.has(o.id)) ids.add(o.id);
    return ids;
  }, [groups, excluded]);

  // A shipping figure that does not parse counts as zero AND is flagged — the
  // sheet must never quietly print a total built on a typo.
  const shippingCents = useMemo(() => {
    const cents: Record<string, number> = {};
    for (const [key, raw] of Object.entries(draft.shipping)) {
      const parsed = raw.trim() === '' ? 0 : parseDollars(raw);
      if (parsed !== null) cents[key] = parsed;
    }
    return cents;
  }, [draft.shipping]);

  const totals = useMemo(
    () => fundingTotals(groups, included, shippingCents),
    [groups, included, shippingCents],
  );

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setShipping = (key: string, value: string) =>
    setDraft((d) => ({ ...d, shipping: { ...d.shipping, [key]: value } }));

  const downloadCsv = () => {
    // The BOM is for Excel, which otherwise reads UTF-8 as Windows-1252 and
    // turns a student's "×" or "é" into mojibake.
    const blob = new Blob(['﻿', fundingRequestCsv(groups, included, shippingCents)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `funding-request-${team.team_number}-${todayStamp()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeGroups = groups.filter((g) => g.orders.some((o) => included.has(o.id)));
  const missingShipping = activeGroups.filter(
    (g) => (draft.shipping[g.key] ?? '').trim() === '',
  );
  const badShipping = activeGroups.filter((g) => {
    const raw = draft.shipping[g.key] ?? '';
    return raw.trim() !== '' && parseDollars(raw) === null;
  });
  const unnamed = activeGroups.some((g) => g.key === '');
  const nothingPicked = totals.vendors.length === 0;

  return (
    <>
      <div className="print:hidden">
        <PageHeader eyebrow="Finance" title="Funding request">
          <Button asChild size="sm" variant="ghost">
            <Link to="/app/finance">
              <ArrowLeft className="size-4" aria-hidden />
              Finance
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={nothingPicked}
            onClick={downloadCsv}
          >
            <Download className="size-4" aria-hidden />
            CSV
          </Button>
          <Button size="sm" disabled={nothingPicked} onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden />
            Print or save PDF
          </Button>
        </PageHeader>
      </div>

      <div className="space-y-4 px-4 py-6 md:px-8 print:p-0">
        <p className="text-muted-foreground max-w-2xl text-sm print:hidden">
          Every approved part request, grouped by the vendor the school will be charged.
          Untick anything you are not asking for yet, add each vendor’s shipping, then
          print it or save it as a PDF for the front office.
        </p>

        {orders.status === 'loading' && <Skeleton className="h-64" />}

        {orders.status === 'error' && (
          <p role="alert" className="text-destructive text-sm">
            Could not load the requests. Reload the page.
          </p>
        )}

        {orders.status === 'ready' && groups.length === 0 && (
          <EmptyState
            title="Nothing approved to ask for."
            aside="Approve part requests on the Part orders tab, and they show up here grouped by vendor."
            action={
              <Button asChild size="sm" variant="outline">
                <Link to="/app/finance">Back to Finance</Link>
              </Button>
            }
          />
        )}

        {orders.status === 'ready' && groups.length > 0 && (
          <>
            {(missingShipping.length > 0 || badShipping.length > 0 || unnamed) && (
              <ul
                role="status"
                className="border-border bg-accent/40 space-y-1 rounded-lg border px-4 py-3 text-sm print:hidden"
              >
                {badShipping.length > 0 && (
                  <li className="text-destructive">
                    Shipping for {badShipping.map((g) => g.label).join(', ')} is not a
                    dollar amount, so it counts as $0 until fixed.
                  </li>
                )}
                {missingShipping.length > 0 && (
                  <li>
                    No shipping entered for{' '}
                    {missingShipping.map((g) => g.label).join(', ')} — it prints as $0.00.
                    Enter 0 if it really ships free.
                  </li>
                )}
                {unnamed && (
                  <li>
                    Some requests name no vendor. The office will want to know who is
                    being paid — edit them on the Part orders tab before they are approved
                    next time.
                  </li>
                )}
              </ul>
            )}

            <article
              aria-label="Funding request"
              className="mx-auto max-w-4xl rounded-lg border border-neutral-200 bg-white px-4 py-6 text-neutral-900 shadow-sm md:px-10 md:py-9 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
            >
              <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-neutral-900 pb-4">
                <div>
                  <div className="text-xs font-semibold tracking-wider text-neutral-500 uppercase">
                    Purchase funding request
                  </div>
                  <h2 className="mt-1 text-2xl font-bold">
                    FTC Team <span className="tabular font-mono">{team.team_number}</span>{' '}
                    · {team.name}
                  </h2>
                </div>
                <dl className="text-sm sm:text-right">
                  <div>
                    <dt className="inline text-neutral-500">Prepared by </dt>
                    <dd className="inline font-medium">{member.display_name}</dd>
                  </div>
                  <div>
                    <dt className="inline text-neutral-500">Date </dt>
                    <dd className="inline font-medium">
                      {new Date().toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </dd>
                  </div>
                </dl>
              </header>

              <section className="mt-5">
                <label
                  htmlFor="funding-note"
                  className="text-xs font-semibold tracking-wider text-neutral-500 uppercase print:hidden"
                >
                  Note to the office (optional)
                </label>
                <textarea
                  id="funding-note"
                  value={draft.note}
                  maxLength={1000}
                  rows={2}
                  placeholder="What these parts are for, an account or budget code, a deadline…"
                  onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:border-neutral-500 focus-visible:ring-2 focus-visible:ring-neutral-300 focus-visible:outline-none print:hidden"
                />
                {draft.note.trim() && (
                  <p className="hidden text-sm whitespace-pre-wrap print:block">
                    {draft.note.trim()}
                  </p>
                )}
              </section>

              <section className="mt-6 break-inside-avoid">
                <h3 className="text-sm font-semibold">Amount to charge, by vendor</h3>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-300 text-left text-xs text-neutral-500">
                        <th className="py-1.5 pr-3 font-medium">Vendor</th>
                        <th className="hidden py-1.5 pr-3 text-right font-medium sm:table-cell">
                          Items
                        </th>
                        <th className="py-1.5 pr-3 text-right font-medium">Subtotal</th>
                        <th className="py-1.5 pr-3 text-right font-medium">Shipping</th>
                        <th className="py-1.5 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {totals.vendors.map((v) => (
                        <tr key={v.key} className="border-b border-neutral-200">
                          <td className="py-1.5 pr-3">{v.label}</td>
                          <td className="tabular hidden py-1.5 pr-3 text-right font-mono sm:table-cell">
                            {v.itemCount}
                          </td>
                          <td className="tabular py-1.5 pr-3 text-right font-mono">
                            {formatCents(v.subtotalCents)}
                          </td>
                          <td className="tabular py-1.5 pr-3 text-right font-mono">
                            {formatCents(v.shippingCents)}
                          </td>
                          <td className="tabular py-1.5 text-right font-mono font-semibold">
                            {formatCents(v.totalCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-neutral-900 font-semibold">
                        <td className="py-2 pr-3">Total requested</td>
                        {/* Under the Items column, which a phone drops. A
                            colSpan would count the hidden cell and skew the row. */}
                        <td className="hidden sm:table-cell" />
                        <td className="tabular py-2 pr-3 text-right font-mono">
                          {formatCents(totals.subtotalCents)}
                        </td>
                        <td className="tabular py-2 pr-3 text-right font-mono">
                          {formatCents(totals.shippingCents)}
                        </td>
                        <td className="tabular py-2 text-right font-mono text-base">
                          {formatCents(totals.totalCents)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>

              <h3 className="mt-8 text-sm font-semibold">Itemized</h3>
              {groups.map((g) => (
                <VendorSection
                  key={g.key}
                  group={g}
                  included={included}
                  onToggle={toggle}
                  shippingRaw={draft.shipping[g.key] ?? ''}
                  shippingCents={shippingCents[g.key] ?? 0}
                  onShipping={(value) => setShipping(g.key, value)}
                />
              ))}

              {/* Wet-ink space for whoever grants it. On screen too, so the
                  preview is honest about what the page will hold. */}
              <section className="mt-12 grid break-inside-avoid grid-cols-1 gap-8 text-sm sm:grid-cols-2">
                {['Approved by', 'Date'].map((label) => (
                  <div key={label}>
                    <div className="h-10 border-b border-neutral-900" />
                    <div className="mt-1 text-xs text-neutral-500">{label}</div>
                  </div>
                ))}
              </section>
            </article>
          </>
        )}
      </div>
    </>
  );
}

function VendorSection({
  group,
  included,
  onToggle,
  shippingRaw,
  shippingCents,
  onShipping,
}: {
  group: VendorGroup;
  included: ReadonlySet<string>;
  onToggle: (id: string) => void;
  shippingRaw: string;
  shippingCents: number;
  onShipping: (value: string) => void;
}) {
  const picked = group.orders.filter((o) => included.has(o.id));
  const subtotal = picked.reduce((sum, o) => sum + lineTotalCents(o), 0);
  const active = picked.length > 0;
  const shippingId = `shipping-${group.key || 'none'}`;
  const invalid = shippingRaw.trim() !== '' && parseDollars(shippingRaw) === null;

  return (
    // A vendor with nothing ticked stays on screen (so it can be ticked back)
    // and leaves the printed page entirely.
    <section className={cn('mt-4 break-inside-avoid', !active && 'print:hidden')}>
      <h4
        className={cn(
          'border-b border-neutral-300 pb-1 text-sm font-semibold',
          group.key === '' && 'text-neutral-500 italic',
          !active && 'text-neutral-400',
        )}
      >
        {group.label}
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sr-only">
            <tr>
              <th className="print:hidden">Include</th>
              <th>Item</th>
              <th className="hidden sm:table-cell">Quantity</th>
              <th className="hidden sm:table-cell">Unit price</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {group.orders.map((o) => {
              const on = included.has(o.id);
              return (
                <tr
                  key={o.id}
                  className={cn(
                    'border-b border-neutral-100 align-top',
                    !on && 'print:hidden',
                  )}
                >
                  <td className="w-8 py-2 print:hidden">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => onToggle(o.id)}
                      aria-label={`Include ${o.item}`}
                      className="mt-0.5 size-4 accent-neutral-900"
                    />
                  </td>
                  <td className={cn('py-2 pr-3', !on && 'text-neutral-400 line-through')}>
                    <div className="font-medium">{o.item}</div>
                    {/* A phone drops the quantity and unit columns so the
                        amount stays in view; they ride under the name instead. */}
                    <div className="tabular font-mono text-xs text-neutral-500 sm:hidden">
                      {o.qty} × {formatCents(o.unit_price_cents)}
                    </div>
                    {o.description && (
                      <div className="text-xs text-neutral-500">{o.description}</div>
                    )}
                    {o.url && (
                      <a
                        href={o.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs break-all text-neutral-500 underline print:no-underline"
                      >
                        {o.url}
                      </a>
                    )}
                  </td>
                  <td
                    className={cn(
                      'tabular hidden w-16 py-2 pr-3 text-right font-mono whitespace-nowrap sm:table-cell',
                      !on && 'text-neutral-400',
                    )}
                  >
                    {o.qty} ×
                  </td>
                  <td
                    className={cn(
                      'tabular hidden w-24 py-2 pr-3 text-right font-mono sm:table-cell',
                      !on && 'text-neutral-400',
                    )}
                  >
                    {formatCents(o.unit_price_cents)}
                  </td>
                  <td
                    className={cn(
                      'tabular w-28 py-2 text-right font-mono',
                      !on && 'text-neutral-400 line-through',
                    )}
                  >
                    {formatCents(lineTotalCents(o))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {active && (
        <dl className="mt-2 ml-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-500">Subtotal</dt>
            <dd className="tabular font-mono">{formatCents(subtotal)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt>
              <label htmlFor={shippingId} className="text-neutral-500">
                Shipping
              </label>
            </dt>
            <dd>
              <div className="relative print:hidden">
                <span
                  className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-neutral-400"
                  aria-hidden
                >
                  $
                </span>
                <input
                  id={shippingId}
                  inputMode="decimal"
                  value={shippingRaw}
                  placeholder="0.00"
                  aria-invalid={invalid || undefined}
                  onChange={(e) => onShipping(e.target.value)}
                  className={cn(
                    'tabular h-9 w-28 rounded-md border bg-white pr-2 pl-5 text-right font-mono text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:ring-2 focus-visible:ring-neutral-300 focus-visible:outline-none',
                    invalid ? 'border-red-600' : 'border-neutral-300',
                  )}
                />
              </div>
              <span className="tabular hidden font-mono print:inline">
                {formatCents(shippingCents)}
              </span>
            </dd>
          </div>
          <div className="flex justify-between border-t border-neutral-900 pt-1 font-semibold">
            <dt>{group.key === '' ? NO_VENDOR_LABEL : group.label} total</dt>
            <dd className="tabular font-mono">{formatCents(subtotal + shippingCents)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
