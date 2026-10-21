/**
 * The funding request: approved part orders, grouped by the vendor that will
 * be charged, for the school front office to sign off before anything is
 * bought.
 *
 * Many school-affiliated teams cannot spend on their own say-so. The coach
 * approves a request in Coglin, and then the school has to grant the money
 * before the order is placed — so between `approved` and `ordered` there is a
 * piece of paper. This file is what goes on it. The front office's question is
 * "how much, to whom", which is why the unit of the report is the VENDOR and
 * not the request: one purchase order per vendor, each with its own shipping.
 *
 * Pure logic, deliberately. The route renders it and the browser prints it;
 * nothing here touches the DOM, so it is testable in workerd (see
 * src/lib/format.test.ts for why that matters).
 *
 * SHIPPING IS NOT A COLUMN on part_orders, and that is on purpose: shipping is
 * a fact about a vendor's cart, not about one item in it. Five servos and a
 * battery from the same shop ship once. So the coach enters one shipping
 * figure per vendor on the report itself, and it lives in the report.
 */
import type { PartOrder } from '@/types';

/** The heading a request with no vendor sorts under. Sorts last. */
export const NO_VENDOR_LABEL = 'No vendor named';

export interface VendorGroup {
  /** Case- and space-folded, so "goBILDA" and "GoBilda " are one cart. */
  key: string;
  /** The first spelling seen, which is what a person typed. */
  label: string;
  orders: PartOrder[];
}

/**
 * The grouping key for a vendor. Lower-cased with runs of whitespace
 * collapsed — a student typing "Rev Robotics" and another typing "REV
 * Robotics" mean one checkout, and splitting them would ask the school for two
 * shipping charges that will never happen. Empty means "no vendor".
 */
export function vendorKey(vendor: string | null): string {
  return (vendor ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Approved orders, grouped by vendor, alphabetical, with the unnamed group
 * last. Items inside a group keep the queue's own order.
 *
 * Only `approved` qualifies. Pending has not been decided, and ordered has
 * already been bought — asking the school for money the team already spent is
 * a different conversation.
 */
export function groupApprovedByVendor(orders: PartOrder[]): VendorGroup[] {
  const groups = new Map<string, VendorGroup>();
  for (const order of orders) {
    if (order.status !== 'approved') continue;
    const key = vendorKey(order.vendor);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: key === '' ? NO_VENDOR_LABEL : (order.vendor ?? '').trim(),
        orders: [],
      };
      groups.set(key, group);
    }
    group.orders.push(order);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === '') return 1;
    if (b.key === '') return -1;
    return a.key.localeCompare(b.key);
  });
}

export function lineTotalCents(
  order: Pick<PartOrder, 'qty' | 'unit_price_cents'>,
): number {
  return order.qty * order.unit_price_cents;
}

export interface VendorTotals {
  key: string;
  label: string;
  itemCount: number;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
}

export interface FundingTotals {
  vendors: VendorTotals[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
}

/**
 * Sums for the report. `included` is the set of order ids the coach left
 * ticked; a vendor with nothing ticked drops out entirely, shipping included,
 * because a cart with nothing in it does not ship. `shipping` is keyed by
 * vendor key, in cents; a missing key counts as zero.
 */
export function fundingTotals(
  groups: VendorGroup[],
  included: ReadonlySet<string>,
  shipping: Readonly<Record<string, number>>,
): FundingTotals {
  const vendors: VendorTotals[] = [];
  for (const group of groups) {
    const picked = group.orders.filter((o) => included.has(o.id));
    if (picked.length === 0) continue;
    const subtotalCents = picked.reduce((sum, o) => sum + lineTotalCents(o), 0);
    const shippingCents = shipping[group.key] ?? 0;
    vendors.push({
      key: group.key,
      label: group.label,
      itemCount: picked.length,
      subtotalCents,
      shippingCents,
      totalCents: subtotalCents + shippingCents,
    });
  }
  const subtotalCents = vendors.reduce((sum, v) => sum + v.subtotalCents, 0);
  const shippingCents = vendors.reduce((sum, v) => sum + v.shippingCents, 0);
  return {
    vendors,
    subtotalCents,
    shippingCents,
    totalCents: subtotalCents + shippingCents,
  };
}

// ------------------------------------------------------------------------ CSV

/** Cents → "312.40": a number a spreadsheet will sum, with no currency sign. */
function csvAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * One CSV field.
 *
 * Item names and descriptions are typed by students, and this file is opened
 * in Excel by somebody in the front office. A cell beginning with `=`, `+`,
 * `-`, `@`, tab or carriage return is a FORMULA there, so those get a leading
 * apostrophe — the OWASP CSV-injection rule. Amounts never take this path:
 * they are written by csvAmount and are never negative.
 */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The report as a spreadsheet: one row per item, one Shipping row per vendor
 * that has any, and a Total row. Flat on purpose, so a filter or a pivot on
 * the Vendor column gives the per-vendor figures without the file having to
 * carry subtotal rows that would double-count under SUM().
 */
export function fundingRequestCsv(
  groups: VendorGroup[],
  included: ReadonlySet<string>,
  shipping: Readonly<Record<string, number>>,
): string {
  const rows: string[][] = [
    ['Vendor', 'Item', 'Description', 'Quantity', 'Unit price', 'Amount', 'Link'],
  ];
  for (const group of groups) {
    const picked = group.orders.filter((o) => included.has(o.id));
    if (picked.length === 0) continue;
    for (const o of picked) {
      rows.push([
        group.label,
        o.item,
        o.description ?? '',
        String(o.qty),
        csvAmount(o.unit_price_cents),
        csvAmount(lineTotalCents(o)),
        o.url ?? '',
      ]);
    }
    const ship = shipping[group.key] ?? 0;
    if (ship > 0) {
      rows.push([group.label, 'Shipping', '', '', '', csvAmount(ship), '']);
    }
  }
  const totals = fundingTotals(groups, included, shipping);
  rows.push(['Total', '', '', '', '', csvAmount(totals.totalCents), '']);
  // CRLF per RFC 4180, which is also what Excel writes.
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}
