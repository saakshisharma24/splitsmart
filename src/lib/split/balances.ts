import { allocateByWeight, sum, type Minor } from '../money';
import { SplitError } from './allocate';
import type { Allocation, Payments, UserId } from './types';

/** One settled fact: this bill cost this much, these people paid, these owed. */
export interface LedgerEntry {
  id: string;
  totalMinor: Minor;
  /** Who actually put money down. Multiple payers on one bill are supported. */
  payments: Payments;
  /** Who owes what, as produced by `allocate()`. */
  allocation: Allocation;
}

/** A repayment that already happened, outside of any expense. */
export interface SettlementEntry {
  id: string;
  from: UserId;
  to: UserId;
  amountMinor: Minor;
}

/**
 * Net position per person: positive means the group owes them, negative means
 * they owe the group. Across everyone it always sums to zero - that is the
 * check that the ledger is internally consistent.
 */
export type NetBalances = Record<UserId, Minor>;

/** Directed debt: `pairwise[a][b] > 0` means a owes b that much. */
export type PairwiseBalances = Record<UserId, Record<UserId, Minor>>;

export function computeNetBalances(
  entries: LedgerEntry[],
  settlements: SettlementEntry[] = [],
): NetBalances {
  const net: NetBalances = {};
  const bump = (u: UserId, delta: Minor) => {
    net[u] = (net[u] ?? 0) + delta;
  };

  for (const entry of entries) {
    const paid = sum(Object.values(entry.payments));
    const owed = sum(Object.values(entry.allocation));
    if (paid !== entry.totalMinor) {
      throw new SplitError(
        `Expense ${entry.id}: payments sum to ${paid} but the total is ${entry.totalMinor}`,
      );
    }
    if (owed !== entry.totalMinor) {
      throw new SplitError(
        `Expense ${entry.id}: shares sum to ${owed} but the total is ${entry.totalMinor}`,
      );
    }
    for (const [u, amt] of Object.entries(entry.payments)) bump(u, amt);
    for (const [u, amt] of Object.entries(entry.allocation)) bump(u, -amt);
  }

  // Paying someone back moves you toward zero and moves them toward zero too.
  for (const s of settlements) {
    if (s.amountMinor < 0) {
      throw new SplitError(`Settlement ${s.id} has a negative amount`);
    }
    bump(s.from, s.amountMinor);
    bump(s.to, -s.amountMinor);
  }

  return net;
}

/**
 * The un-simplified view: exactly who owes whom, bill by bill.
 *
 * Kept alongside the simplified view on purpose. Debt simplification is great
 * for settling up, but people also want to see the literal truth - "I owe Priya
 * because she covered the hotel" - and a graph that has been rewritten into
 * minimum transfers can no longer answer that question.
 */
export function computePairwiseBalances(
  entries: LedgerEntry[],
  settlements: SettlementEntry[] = [],
): PairwiseBalances {
  const owes: PairwiseBalances = {};
  const bump = (from: UserId, to: UserId, delta: Minor) => {
    if (from === to) return;
    owes[from] ??= {};
    owes[from][to] = (owes[from][to] ?? 0) + delta;
  };

  for (const entry of entries) {
    const payers = Object.entries(entry.payments).filter(([, amt]) => amt !== 0);
    if (payers.length === 0) continue;

    for (const [debtor, owedAmount] of Object.entries(entry.allocation)) {
      if (owedAmount === 0) continue;
      // Split what this person owes across the payers, in proportion to how
      // much each payer actually fronted. Routed through allocateByWeight so
      // the pieces still add back up to `owedAmount`.
      const parts = allocateByWeight(owedAmount, payers.map(([, amt]) => amt));
      payers.forEach(([payer], i) => {
        if (payer !== debtor) bump(debtor, payer, parts[i]);
        // A payer's own share just cancels out, so it is intentionally dropped.
      });
    }
  }

  for (const s of settlements) bump(s.to, s.from, s.amountMinor);

  return netPairwise(owes);
}

/** Collapse a <-> b into a single direction so we never show both ways at once. */
function netPairwise(raw: PairwiseBalances): PairwiseBalances {
  const out: PairwiseBalances = {};
  const seen = new Set<string>();

  for (const a of Object.keys(raw)) {
    for (const b of Object.keys(raw[a])) {
      const key = [a, b].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);

      const net = (raw[a]?.[b] ?? 0) - (raw[b]?.[a] ?? 0);
      if (net === 0) continue;
      const [from, to, amt] = net > 0 ? [a, b, net] : [b, a, -net];
      out[from] ??= {};
      out[from][to] = amt;
    }
  }
  return out;
}

/** Sanity check: a closed ledger always nets to zero across all members. */
export function isBalanced(net: NetBalances): boolean {
  return sum(Object.values(net)) === 0;
}
