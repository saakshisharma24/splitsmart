import { describe, expect, it } from 'vitest';
import { sum } from '@/lib/money';
import { allocate, SplitError, validateSplit } from '@/lib/split/allocate';
import type { SplitSpec } from '@/lib/split/types';

const [ari, sam, priya, dev] = ['ari', 'sam', 'priya', 'dev'];

describe('EQUAL', () => {
  it('splits evenly and still sums exactly', () => {
    const got = allocate(10000, { mode: 'EQUAL', participants: [ari, sam, priya] });
    expect(got).toEqual({ ari: 3334, sam: 3333, priya: 3333 });
    expect(sum(Object.values(got))).toBe(10000);
  });

  it('handles a single participant', () => {
    expect(allocate(500, { mode: 'EQUAL', participants: [ari] })).toEqual({ ari: 500 });
  });

  it('rejects an empty or duplicated participant list', () => {
    expect(() => allocate(100, { mode: 'EQUAL', participants: [] })).toThrow(SplitError);
    expect(() => allocate(100, { mode: 'EQUAL', participants: [ari, ari] })).toThrow(SplitError);
  });
});

describe('EXACT', () => {
  it('accepts amounts that add to the total', () => {
    const spec: SplitSpec = { mode: 'EXACT', amounts: { ari: 6000, sam: 4000 } };
    expect(allocate(10000, spec)).toEqual({ ari: 6000, sam: 4000 });
  });

  it('refuses amounts that do not reconcile', () => {
    const spec: SplitSpec = { mode: 'EXACT', amounts: { ari: 6000, sam: 3000 } };
    expect(() => allocate(10000, spec)).toThrow(/does not match the total/);
  });
});

describe('PERCENT', () => {
  it('uses basis points so fractional percents stay exact', () => {
    // 33.33% / 33.33% / 33.34%
    const got = allocate(10000, {
      mode: 'PERCENT',
      basisPoints: { ari: 3333, sam: 3333, priya: 3334 },
    });
    expect(sum(Object.values(got))).toBe(10000);
    expect(got.priya).toBeGreaterThanOrEqual(got.ari);
  });

  it('refuses percentages that miss 100%', () => {
    expect(() =>
      allocate(10000, { mode: 'PERCENT', basisPoints: { ari: 5000, sam: 4000 } }),
    ).toThrow(/not 100%/);
  });
});

describe('SHARES', () => {
  it('models "he eats twice as much"', () => {
    const got = allocate(9000, { mode: 'SHARES', shares: { ari: 2, sam: 1 } });
    expect(got).toEqual({ ari: 6000, sam: 3000 });
  });

  it('lets a member sit out with a zero share', () => {
    const got = allocate(9000, { mode: 'SHARES', shares: { ari: 2, sam: 1, priya: 0 } });
    expect(got.priya).toBe(0);
    expect(sum(Object.values(got))).toBe(9000);
  });

  it('refuses an all-zero share map', () => {
    expect(() => allocate(100, { mode: 'SHARES', shares: { ari: 0, sam: 0 } })).toThrow();
  });
});

describe('ITEMIZED', () => {
  // The restaurant case this app exists for.
  const spec: SplitSpec = {
    mode: 'ITEMIZED',
    participants: [ari, sam, priya],
    items: [
      { id: 'i1', label: 'Steak', amountMinor: 90000, participants: [ari] },
      { id: 'i2', label: 'Dal', amountMinor: 12000, participants: [sam] },
      { id: 'i3', label: 'Naan basket', amountMinor: 18000, participants: [ari, sam, priya] },
    ],
    taxMinor: 6000,
    tipMinor: 12000,
  };
  // items 120000 + tax 6000 + tip 12000 = 138000
  const total = 138000;

  it('charges each person for what they ordered', () => {
    const got = allocate(total, spec);
    expect(sum(Object.values(got))).toBe(total);
    // Ari ordered the steak, so Ari carries the most.
    expect(got.ari).toBeGreaterThan(got.sam);
    expect(got.sam).toBeGreaterThan(got.priya);
  });

  it('spreads tax and tip proportionally, not equally', () => {
    const got = allocate(total, spec);
    // Priya only shared the naan: subtotal 6000 of 120000, so 5% of the
    // 18000 surcharge = 900. An equal split would have charged her 6000.
    expect(got.priya).toBe(6000 + 900);
    expect(got.priya).toBeLessThan(6000 + 18000 / 3);
  });

  it('treats an empty participant list as "shared by the table"', () => {
    const shared = allocate(3000, {
      mode: 'ITEMIZED',
      participants: [ari, sam, priya],
      items: [{ id: 'i1', label: 'Water', amountMinor: 3000, participants: [] }],
    });
    expect(sum(Object.values(shared))).toBe(3000);
    expect(shared.ari).toBe(1000);
  });

  it('applies a discount', () => {
    const got = allocate(90000, {
      mode: 'ITEMIZED',
      participants: [ari, sam],
      items: [
        { id: 'i1', label: 'A', amountMinor: 60000, participants: [ari] },
        { id: 'i2', label: 'B', amountMinor: 40000, participants: [sam] },
      ],
      discountMinor: 10000,
    });
    expect(sum(Object.values(got))).toBe(90000);
    expect(got.ari).toBe(54000); // 60000 - 60% of the 10000 off
    expect(got.sam).toBe(36000);
  });

  it('catches a total that does not match the lines', () => {
    expect(() => allocate(99999, spec)).toThrow(/does not match the bill total/);
  });

  it('catches an item assigned to someone not on the bill', () => {
    expect(() =>
      allocate(1000, {
        mode: 'ITEMIZED',
        participants: [ari],
        items: [{ id: 'i1', label: 'X', amountMinor: 1000, participants: [dev] }],
      }),
    ).toThrow(/not on this bill/);
  });
});

describe('the invariant that matters', () => {
  it('every mode sums to exactly the total, over random totals', () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const people = [ari, sam, priya, dev];
    for (let i = 0; i < 2000; i++) {
      const total = 1 + Math.floor(rnd() * 1_000_000);
      const n = 1 + Math.floor(rnd() * 4);
      const chosen = people.slice(0, n);

      expect(sum(Object.values(allocate(total, { mode: 'EQUAL', participants: chosen })))).toBe(total);

      const shares = Object.fromEntries(chosen.map((p) => [p, 1 + Math.floor(rnd() * 9)]));
      expect(sum(Object.values(allocate(total, { mode: 'SHARES', shares })))).toBe(total);
    }
  });
});

describe('validateSplit', () => {
  it('reports problems instead of throwing, for form use', () => {
    expect(validateSplit(100, { mode: 'EQUAL', participants: [ari] })).toEqual([]);
    expect(validateSplit(100, { mode: 'EQUAL', participants: [] })).toHaveLength(1);
  });
});
