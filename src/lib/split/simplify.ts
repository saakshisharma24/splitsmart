import { sum, type Minor } from '../money';
import type { NetBalances } from './balances';
import type { Transfer, UserId } from './types';

/**
 * Debt simplification - the feature that makes a group of six stop doing
 * fifteen separate UPI transfers.
 *
 * Given everyone's net position, produce a small set of payments that clears
 * the whole group at once. If Ari owes Sam 500 and Sam owes Priya 500, the
 * answer is one payment: Ari pays Priya 500. Sam never touches his phone.
 *
 * ON OPTIMALITY, honestly: finding the provably fewest transfers is NP-hard
 * (it reduces to set partition - you are looking for the largest number of
 * disjoint zero-sum subsets). This runs a two-stage heuristic instead:
 *
 *   1. Cancel exact matches. A debtor owing exactly what some creditor is owed
 *      is a free win: one transfer retires two people.
 *   2. Greedily match the largest remaining debtor against the largest
 *      remaining creditor.
 *
 * Stage 2 alone already guarantees at most n-1 transfers for n people with
 * non-zero balances, which is the bound that matters in practice; stage 1
 * typically takes real groups well below it. Both stages break ties on user id
 * so the same ledger always yields the same payment plan - a plan that
 * reshuffles between page loads is one nobody trusts.
 */
export function simplifyDebts(net: NetBalances): Transfer[] {
  const total = sum(Object.values(net));
  if (total !== 0) {
    throw new Error(
      `Cannot simplify an unbalanced ledger: net positions sum to ${total}, expected 0`,
    );
  }

  // Work on a mutable copy, dropping anyone already square.
  const debtors: Array<{ id: UserId; amount: Minor }> = [];
  const creditors: Array<{ id: UserId; amount: Minor }> = [];
  for (const [id, amount] of Object.entries(net)) {
    if (amount < 0) debtors.push({ id, amount: -amount });
    else if (amount > 0) creditors.push({ id, amount });
  }

  const transfers: Transfer[] = [];

  // Stage 1: exact matches. One payment, two people done.
  for (const d of debtors) {
    if (d.amount === 0) continue;
    const match = creditors
      .filter((c) => c.amount === d.amount)
      .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    if (match) {
      transfers.push({ from: d.id, to: match.id, amountMinor: d.amount });
      d.amount = 0;
      match.amount = 0;
    }
  }

  // Stage 2: greedy largest-against-largest on whatever is left.
  const byAmountDesc = (a: { id: UserId; amount: Minor }, b: { id: UserId; amount: Minor }) =>
    b.amount - a.amount || (a.id < b.id ? -1 : 1);

  const owing = debtors.filter((d) => d.amount > 0).sort(byAmountDesc);
  const owed = creditors.filter((c) => c.amount > 0).sort(byAmountDesc);

  let i = 0;
  let j = 0;
  while (i < owing.length && j < owed.length) {
    const amount = Math.min(owing[i].amount, owed[j].amount);
    transfers.push({ from: owing[i].id, to: owed[j].id, amountMinor: amount });
    owing[i].amount -= amount;
    owed[j].amount -= amount;
    if (owing[i].amount === 0) i++;
    if (owed[j].amount === 0) j++;
  }

  // Present the plan biggest-payment-first; it reads better in a settle-up list.
  transfers.sort(
    (a, b) =>
      b.amountMinor - a.amountMinor ||
      (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) ||
      (a.to < b.to ? -1 : 1),
  );

  assertPlanClearsLedger(net, transfers);
  return transfers;
}

/**
 * A payment plan is only correct if applying it leaves everybody at zero.
 * Checked on every call rather than only in tests - a wrong plan moves real
 * money, so the cheap O(n) verification is worth it.
 */
function assertPlanClearsLedger(net: NetBalances, transfers: Transfer[]): void {
  const after: Record<UserId, Minor> = { ...net };
  for (const t of transfers) {
    if (t.amountMinor <= 0) {
      throw new Error(`Payment plan contains a non-positive transfer of ${t.amountMinor}`);
    }
    after[t.from] = (after[t.from] ?? 0) + t.amountMinor;
    after[t.to] = (after[t.to] ?? 0) - t.amountMinor;
  }
  const unsettled = Object.entries(after).filter(([, v]) => v !== 0);
  if (unsettled.length > 0) {
    throw new Error(
      `Payment plan does not clear the ledger; left over: ${JSON.stringify(unsettled)}`,
    );
  }
}

/**
 * How much better the simplified plan is than paying everyone back directly.
 * Surfaced in the UI as "6 payments instead of 15" - it is the single clearest
 * way to show a user why this app is worth using.
 */
export function simplificationSavings(
  pairwiseCount: number,
  simplified: Transfer[],
): { before: number; after: number; saved: number } {
  const after = simplified.length;
  return { before: pairwiseCount, after, saved: Math.max(0, pairwiseCount - after) };
}

/** Only the payments the given user has to make or receive. */
export function transfersFor(transfers: Transfer[], userId: UserId): {
  toPay: Transfer[];
  toReceive: Transfer[];
} {
  return {
    toPay: transfers.filter((t) => t.from === userId),
    toReceive: transfers.filter((t) => t.to === userId),
  };
}
