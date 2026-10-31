import { allocateByWeight, allocateEqually, assertMinor, sum, type Minor } from '../money';
import type { Allocation, ItemizedSplit, SplitSpec, UserId } from './types';

export class SplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SplitError';
  }
}

const BASIS_POINTS_TOTAL = 10_000;

/**
 * Turn a split spec into "who owes what" for a single expense.
 *
 * Post-condition, guaranteed for every mode: the returned amounts sum to
 * EXACTLY `totalMinor`. Every mode routes its rounding through
 * `allocateByWeight`, so a leftover paise is always given to somebody rather
 * than quietly dropped. The function asserts this before returning - if the
 * invariant ever breaks, it should break loudly in tests, not silently in
 * somebody's balance six months later.
 */
export function allocate(totalMinor: Minor, spec: SplitSpec): Allocation {
  assertMinor(totalMinor, 'totalMinor');

  let result: Allocation;
  switch (spec.mode) {
    case 'EQUAL':
      result = allocateEqual(totalMinor, spec.participants);
      break;
    case 'EXACT':
      result = allocateExact(totalMinor, spec.amounts);
      break;
    case 'PERCENT':
      result = allocatePercent(totalMinor, spec.basisPoints);
      break;
    case 'SHARES':
      result = allocateShares(totalMinor, spec.shares);
      break;
    case 'ITEMIZED':
      result = allocateItemized(totalMinor, spec);
      break;
    default: {
      const exhaustive: never = spec;
      throw new SplitError(`Unknown split mode: ${JSON.stringify(exhaustive)}`);
    }
  }

  const allocated = sum(Object.values(result));
  if (allocated !== totalMinor) {
    throw new SplitError(
      `Allocation invariant violated: parts sum to ${allocated} but total is ${totalMinor}`,
    );
  }
  return result;
}

function requireParticipants(participants: UserId[]): UserId[] {
  const unique = [...new Set(participants)];
  if (unique.length === 0) {
    throw new SplitError('A split needs at least one participant');
  }
  if (unique.length !== participants.length) {
    throw new SplitError('The same participant was listed twice');
  }
  return unique;
}

function allocateEqual(total: Minor, participants: UserId[]): Allocation {
  const people = requireParticipants(participants);
  const parts = allocateEqually(total, people.length);
  return Object.fromEntries(people.map((u, i) => [u, parts[i]]));
}

function allocateExact(total: Minor, amounts: Record<UserId, Minor>): Allocation {
  const entries = Object.entries(amounts);
  if (entries.length === 0) throw new SplitError('An exact split needs at least one amount');
  for (const [user, amt] of entries) assertMinor(amt, `amount for ${user}`);

  const given = sum(entries.map(([, a]) => a));
  if (given !== total) {
    throw new SplitError(
      `Exact amounts sum to ${given}, which does not match the total of ${total}`,
    );
  }
  return Object.fromEntries(entries);
}

function allocatePercent(total: Minor, basisPoints: Record<UserId, number>): Allocation {
  const entries = Object.entries(basisPoints);
  if (entries.length === 0) throw new SplitError('A percentage split needs at least one share');

  for (const [user, bp] of entries) {
    if (!Number.isInteger(bp) || bp < 0) {
      throw new SplitError(`Percentage for ${user} must be a non-negative whole basis point value`);
    }
  }
  const given = entries.reduce((a, [, bp]) => a + bp, 0);
  if (given !== BASIS_POINTS_TOTAL) {
    throw new SplitError(
      `Percentages add up to ${given / 100}%, not 100%`,
    );
  }

  const parts = allocateByWeight(total, entries.map(([, bp]) => bp));
  return Object.fromEntries(entries.map(([u], i) => [u, parts[i]]));
}

function allocateShares(total: Minor, shares: Record<UserId, number>): Allocation {
  const entries = Object.entries(shares);
  if (entries.length === 0) throw new SplitError('A shares split needs at least one share');

  for (const [user, s] of entries) {
    if (!Number.isFinite(s) || s < 0) {
      throw new SplitError(`Share for ${user} must be a non-negative number`);
    }
  }
  if (entries.every(([, s]) => s === 0)) {
    throw new SplitError('At least one participant needs a share above zero');
  }

  const parts = allocateByWeight(total, entries.map(([, s]) => s));
  return Object.fromEntries(entries.map(([u], i) => [u, parts[i]]));
}

/**
 * Itemized: each line goes to the people who ordered it, then tax, tip and
 * discount are spread in proportion to what each person's items came to.
 *
 * Proportional - not equal - is the fair treatment: if you ordered the ₹900
 * steak and I ordered the ₹120 dal, you caused most of the 18% tax, so you
 * carry most of it. Someone who ordered nothing pays nothing, including no tax.
 */
function allocateItemized(total: Minor, spec: ItemizedSplit): Allocation {
  const people = requireParticipants(spec.participants);
  const onBill = new Set(people);

  if (spec.items.length === 0) throw new SplitError('An itemized split needs at least one item');

  const tax = spec.taxMinor ?? 0;
  const tip = spec.tipMinor ?? 0;
  const discount = spec.discountMinor ?? 0;
  assertMinor(tax, 'taxMinor');
  assertMinor(tip, 'tipMinor');
  assertMinor(discount, 'discountMinor');
  if (discount < 0) throw new SplitError('Discount must be a positive amount that is subtracted');

  // Step 1: attribute every line to the people who consumed it.
  const subtotal: Record<UserId, Minor> = Object.fromEntries(people.map((u) => [u, 0]));
  for (const item of spec.items) {
    assertMinor(item.amountMinor, `amount for item "${item.label}"`);
    // An empty participant list means "shared by the whole table".
    const eaters = item.participants.length > 0 ? [...new Set(item.participants)] : people;
    for (const u of eaters) {
      if (!onBill.has(u)) {
        throw new SplitError(`Item "${item.label}" is assigned to ${u}, who is not on this bill`);
      }
    }
    const parts = allocateEqually(item.amountMinor, eaters.length);
    eaters.forEach((u, i) => {
      subtotal[u] += parts[i];
    });
  }

  // Step 2: the stated total has to match what the lines actually add up to.
  const itemsTotal = sum(Object.values(subtotal));
  const expected = itemsTotal + tax + tip - discount;
  if (expected !== total) {
    throw new SplitError(
      `Itemized lines come to ${itemsTotal} plus ${tax} tax plus ${tip} tip minus ${discount} ` +
        `discount = ${expected}, which does not match the bill total of ${total}`,
    );
  }

  // Step 3: spread tax + tip - discount proportionally to each person's subtotal.
  const surcharge = tax + tip - discount;
  const shares = allocateByWeight(surcharge, people.map((u) => subtotal[u]));

  return Object.fromEntries(people.map((u, i) => [u, subtotal[u] + shares[i]]));
}

/**
 * Non-throwing counterpart for forms and API validation: returns the list of
 * human-readable problems instead of blowing up on the first one.
 */
export function validateSplit(totalMinor: Minor, spec: SplitSpec): string[] {
  try {
    allocate(totalMinor, spec);
    return [];
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)];
  }
}
