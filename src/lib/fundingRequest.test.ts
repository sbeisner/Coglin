import { describe, expect, it } from 'vitest';
import type { PartOrder } from '@/types';
import {
  csvField,
  fundingRequestCsv,
  fundingTotals,
  groupApprovedByVendor,
  NO_VENDOR_LABEL,
  vendorKey,
} from './fundingRequest';

/**
 * The funding request is money the school is asked to grant, so the sums are
 * the part that must be right — a report that renders but adds wrong reads
 * exactly like one that adds right.
 */

let seq = 0;
function order(overrides: Partial<PartOrder>): PartOrder {
  seq += 1;
  return {
    id: `o${seq}`,
    item: `Item ${seq}`,
    description: null,
    url: null,
    vendor: null,
    qty: 1,
    unit_price_cents: 1000,
    status: 'approved',
    requested_by: null,
    decided_by: null,
    decided_at: null,
    decision_note: null,
    ordered_at: null,
    received_at: null,
    transaction_id: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

describe('vendorKey', () => {
  it('folds case and whitespace so one checkout is one group', () => {
    expect(vendorKey('  REV   Robotics ')).toBe('rev robotics');
    expect(vendorKey('Rev Robotics')).toBe('rev robotics');
  });

  it('treats null and blank as no vendor', () => {
    expect(vendorKey(null)).toBe('');
    expect(vendorKey('   ')).toBe('');
  });
});

describe('groupApprovedByVendor', () => {
  it('keeps only approved orders', () => {
    const groups = groupApprovedByVendor([
      order({ vendor: 'goBILDA', status: 'pending' }),
      order({ vendor: 'goBILDA', status: 'ordered' }),
      order({ vendor: 'goBILDA', status: 'denied' }),
      order({ vendor: 'goBILDA', status: 'approved', id: 'keep' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].orders.map((o) => o.id)).toEqual(['keep']);
  });

  it('merges spellings, keeps the first label, sorts with unnamed last', () => {
    const groups = groupApprovedByVendor([
      order({ vendor: null }),
      order({ vendor: 'goBILDA' }),
      order({ vendor: 'AndyMark' }),
      order({ vendor: 'GoBilda ' }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['AndyMark', 'goBILDA', NO_VENDOR_LABEL]);
    expect(groups[1].orders).toHaveLength(2);
  });
});

describe('fundingTotals', () => {
  const a1 = order({ vendor: 'AndyMark', qty: 2, unit_price_cents: 1250 });
  const a2 = order({ vendor: 'AndyMark', qty: 1, unit_price_cents: 499 });
  const g1 = order({ vendor: 'goBILDA', qty: 3, unit_price_cents: 3499 });
  const groups = groupApprovedByVendor([a1, a2, g1]);

  it('adds shipping once per vendor, not per item', () => {
    const totals = fundingTotals(groups, new Set([a1.id, a2.id, g1.id]), {
      andymark: 895,
      gobilda: 1200,
    });
    expect(totals.vendors).toEqual([
      {
        key: 'andymark',
        label: 'AndyMark',
        itemCount: 2,
        subtotalCents: 2999,
        shippingCents: 895,
        totalCents: 3894,
      },
      {
        key: 'gobilda',
        label: 'goBILDA',
        itemCount: 1,
        subtotalCents: 10497,
        shippingCents: 1200,
        totalCents: 11697,
      },
    ]);
    expect(totals.subtotalCents).toBe(13496);
    expect(totals.shippingCents).toBe(2095);
    expect(totals.totalCents).toBe(15591);
  });

  it('drops a vendor with nothing ticked, shipping and all', () => {
    const totals = fundingTotals(groups, new Set([g1.id]), {
      andymark: 895,
      gobilda: 0,
    });
    expect(totals.vendors.map((v) => v.key)).toEqual(['gobilda']);
    expect(totals.totalCents).toBe(10497);
  });

  it('counts missing shipping as zero', () => {
    const totals = fundingTotals(groups, new Set([a2.id]), {});
    expect(totals.totalCents).toBe(499);
  });
});

describe('csvField', () => {
  it('neutralises spreadsheet formulas', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('-cmd')).toBe("'-cmd");
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('quotes commas, quotes and newlines', () => {
    expect(csvField('a, b')).toBe('"a, b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField('plain')).toBe('plain');
  });
});

describe('fundingRequestCsv', () => {
  it('writes item rows, a shipping row per vendor that has one, and a total', () => {
    const s = order({
      vendor: 'REV',
      item: 'Servo, smart',
      qty: 2,
      unit_price_cents: 3500,
      url: 'https://rev.example/servo',
    });
    const b = order({
      vendor: 'AndyMark',
      item: 'Battery',
      unit_price_cents: 6000,
    });
    const skipped = order({ vendor: 'AndyMark', item: 'Unticked' });
    const groups = groupApprovedByVendor([s, b, skipped]);

    const csv = fundingRequestCsv(groups, new Set([s.id, b.id]), {
      rev: 999,
      andymark: 0,
    });
    expect(csv.split('\r\n')).toEqual([
      'Vendor,Item,Description,Quantity,Unit price,Amount,Link',
      'AndyMark,Battery,,1,60.00,60.00,',
      'REV,"Servo, smart",,2,35.00,70.00,https://rev.example/servo',
      'REV,Shipping,,,,9.99,',
      'Total,,,,,139.99,',
      '',
    ]);
  });
});
