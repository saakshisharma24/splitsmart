import { describe, expect, it } from 'vitest';
import { sum } from '@/lib/money';
import { allocate } from '@/lib/split/allocate';
import {
  computeNetBalances,
  computePairwiseBalances,
  isBalanced,
  type LedgerEntry,
  type SettlementEntry,
} from '@/lib/split/balances';
import { simplificationSavings, simplifyDebts, transfersFor } from '@/lib/split/simplify';

const countPairs = (p: Record<string, Record<string, number>>) =>
  Object.values(p).reduce((n, row) => n + Object.keys(row).length, 0);

describe('computeNetBalances', () => {
  it('nets paying against owing', () => {
    const entries: LedgerEntry[] = [
      {
        id: 'e1',
        totalMinor: 30000,
        payments: { ari: 30000 },
        allocation: allocate(30000, { mode: 'EQUAL', participants: ['ari', 'sam', 'priya'] }),
      },
    ];
    const net = computeNetBalances(entries);
    // Ari fronted 30000 and owes 10000 of it, so the group owes Ari 20000.
    expect(net.ari).toBe(20000);
    expect(net.sam).toBe(-10000);
    expect(net.priya).toBe(-10000);
    expect(isBalanced(net)).toBe(true);
  });

  it('always nets to zero across the group', () => {
    const entries: LedgerEntry[] = [
      {
        id: 'e1',
        totalMinor: 10000,
        payments: { ari: 10000 },
        allocation: allocate(10000, { mode: 'EQUAL', participants: ['ari', 'sam', 'priya'] }),
      },
      {
        id: 'e2',
        totalMinor: 7777,
        payments: { sam: 7777 },
        allocation: allocate(7777, { mode: 'SHARES', shares: { ari: 3, sam: 1, priya: 2 } }),
      },
    ];
    expect(sum(Object.values(computeNetBalances(entries)))).toBe(0);
  });

  it('supports several people paying one bill', () => {
    const net = computeNetBalances([
      {
        id: 'e1',
        totalMinor: 10000,
        payments: { ari: 6000, sam: 4000 },
        allocation: allocate(10000, { mode: 'EQUAL', participants: ['ari', 'sam'] }),
      },
    ]);
    expect(net.ari).toBe(1000);
    expect(net.sam).toBe(-1000);
  });

  it('moves everyone toward zero when a settlement is recorded', () => {
    const entries: LedgerEntry[] = [
      {
        id: 'e1',
        totalMinor: 20000,
        payments: { ari: 20000 },
        allocation: allocate(20000, { mode: 'EQUAL', participants: ['ari', 'sam'] }),
      },
    ];
    const settlements: SettlementEntry[] = [
      { id: 's1', from: 'sam', to: 'ari', amountMinor: 10000 },
    ];
    const net = computeNetBalances(entries, settlements);
    expect(net.ari).toBe(0);
    expect(net.sam).toBe(0);
  });

  it('rejects a bill whose payments do not match its total', () => {
    expect(() =>
      computeNetBalances([
        { id: 'bad', totalMinor: 100, payments: { ari: 90 }, allocation: { ari: 100 } },
      ]),
    ).toThrow(/payments sum to/);
  });
});

describe('simplifyDebts', () => {
  it('collapses a chain into one payment', () => {
    // Ari owes Sam 500, Sam owes Priya 500 -> Ari just pays Priya.
    const net = { ari: -50000, sam: 0, priya: 50000 };
    const plan = simplifyDebts(net);
    expect(plan).toEqual([{ from: 'ari', to: 'priya', amountMinor: 50000 }]);
  });

  it('never needs more than n-1 payments', () => {
    const net = { a: -30000, b: -20000, c: -10000, d: 25000, e: 35000 };
    const plan = simplifyDebts(net);
    expect(plan.length).toBeLessThanOrEqual(Object.keys(net).length - 1);
  });

  it('leaves everyone at exactly zero', () => {
    const net = { a: -33333, b: -16667, c: 20000, d: 30000 };
    const after: Record<string, number> = { ...net };
    for (const t of simplifyDebts(net)) {
      after[t.from] += t.amountMinor;
      after[t.to] -= t.amountMinor;
    }
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
  });

  it('is deterministic - the same ledger yields the same plan every time', () => {
    const net = { a: -7000, b: -3000, c: 4000, d: 6000 };
    const first = JSON.stringify(simplifyDebts(net));
    for (let i = 0; i < 25; i++) {
      expect(JSON.stringify(simplifyDebts(net))).toBe(first);
    }
  });

  it('takes the exact-match shortcut when one exists', () => {
    // b owes exactly what c is owed: that should be one direct payment,
    // not a payment sliced across two creditors.
    const plan = simplifyDebts({ a: -5000, b: -3000, c: 3000, d: 5000 });
    expect(plan).toContainEqual({ from: 'b', to: 'c', amountMinor: 3000 });
    expect(plan).toContainEqual({ from: 'a', to: 'd', amountMinor: 5000 });
    expect(plan).toHaveLength(2);
  });

  it('returns nothing for a settled group', () => {
    expect(simplifyDebts({ a: 0, b: 0 })).toEqual([]);
    expect(simplifyDebts({})).toEqual([]);
  });

  it('refuses an unbalanced ledger rather than inventing money', () => {
    expect(() => simplifyDebts({ a: -100, b: 50 })).toThrow(/unbalanced/);
  });

  it('holds up over random ledgers', () => {
    let seed = 99;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 500; round++) {
      const n = 2 + Math.floor(rnd() * 8);
      const ids = Array.from({ length: n }, (_, i) => `u${i}`);
      const net: Record<string, number> = {};
      let running = 0;
      for (let i = 0; i < n - 1; i++) {
        const v = Math.floor(rnd() * 200000) - 100000;
        net[ids[i]] = v;
        running += v;
      }
      net[ids[n - 1]] = -running; // force it to balance

      const plan = simplifyDebts(net);
      const nonZero = Object.values(net).filter((v) => v !== 0).length;
      expect(plan.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));

      const after = { ...net };
      for (const t of plan) {
        expect(t.amountMinor).toBeGreaterThan(0);
        after[t.from] += t.amountMinor;
        after[t.to] -= t.amountMinor;
      }
      expect(Object.values(after).every((v) => v === 0)).toBe(true);
    }
  });
});

describe('simplification against the naive alternative', () => {
  it('cuts the number of payments a real group has to make', () => {
    // Four flatmates, four bills, each fronted by a different person.
    const members = ['ari', 'sam', 'priya', 'dev'];
    const entries: LedgerEntry[] = members.map((payer, i) => ({
      id: `e${i}`,
      totalMinor: 10000 * (i + 1),
      payments: { [payer]: 10000 * (i + 1) },
      allocation: allocate(10000 * (i + 1), { mode: 'EQUAL', participants: members }),
    }));

    const pairwise = computePairwiseBalances(entries);
    const plan = simplifyDebts(computeNetBalances(entries));
    const savings = simplificationSavings(countPairs(pairwise), plan);

    expect(savings.after).toBeLessThan(savings.before);
    expect(savings.saved).toBe(savings.before - savings.after);
  });
});

describe('transfersFor', () => {
  it('picks out one person"s side of the plan', () => {
    const plan = simplifyDebts({ a: -1000, b: 1000 });
    expect(transfersFor(plan, 'a').toPay).toHaveLength(1);
    expect(transfersFor(plan, 'a').toReceive).toHaveLength(0);
    expect(transfersFor(plan, 'b').toReceive).toHaveLength(1);
  });
});

describe('computePairwiseBalances', () => {
  it('shows the literal truth, one direction only', () => {
    const entries: LedgerEntry[] = [
      {
        id: 'e1',
        totalMinor: 20000,
        payments: { ari: 20000 },
        allocation: allocate(20000, { mode: 'EQUAL', participants: ['ari', 'sam'] }),
      },
      {
        id: 'e2',
        totalMinor: 6000,
        payments: { sam: 6000 },
        allocation: allocate(6000, { mode: 'EQUAL', participants: ['ari', 'sam'] }),
      },
    ];
    const p = computePairwiseBalances(entries);
    // Sam owes 10000, Ari owes 3000 -> net: Sam owes Ari 7000, shown once.
    expect(p.sam?.ari).toBe(7000);
    expect(p.ari?.sam).toBeUndefined();
  });
});
