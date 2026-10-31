import type { Minor } from '../money';

export type UserId = string;

export type SplitMode = 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES' | 'ITEMIZED';

/** Everyone listed pays the same amount. The default, and ~80% of real use. */
export interface EqualSplit {
  mode: 'EQUAL';
  participants: UserId[];
}

/** Caller states each person's amount outright. Must sum to the total. */
export interface ExactSplit {
  mode: 'EXACT';
  amounts: Record<UserId, Minor>;
}

/**
 * Percentages, carried as basis points (1% = 100 bp) so we never store a
 * fractional percent as a float. Must sum to 10_000.
 */
export interface PercentSplit {
  mode: 'PERCENT';
  basisPoints: Record<UserId, number>;
}

/**
 * Relative shares - "Ari eats twice as much as Sam" is {ari: 2, sam: 1}.
 * Also how you model a couple sharing one slot in a group trip.
 */
export interface SharesSplit {
  mode: 'SHARES';
  shares: Record<UserId, number>;
}

export interface LineItem {
  id: string;
  label: string;
  /** Line total (unit price x quantity), already in minor units. */
  amountMinor: Minor;
  /** Who actually consumed this line. Empty = shared by everyone on the bill. */
  participants: UserId[];
}

/**
 * The restaurant case: per-item attribution, with tax/tip/discount spread
 * across people in proportion to what they personally ordered. This is the
 * mode Google Pay's split doesn't have, and the reason most people still
 * settle restaurant bills by hand.
 */
export interface ItemizedSplit {
  mode: 'ITEMIZED';
  items: LineItem[];
  /** Everyone on the bill, including anyone who ordered nothing but owes tax/tip. */
  participants: UserId[];
  taxMinor?: Minor;
  tipMinor?: Minor;
  /** Positive number; subtracted from the bill. */
  discountMinor?: Minor;
}

export type SplitSpec =
  | EqualSplit
  | ExactSplit
  | PercentSplit
  | SharesSplit
  | ItemizedSplit;

/** What everyone owes for one expense. Always sums to the expense total. */
export type Allocation = Record<UserId, Minor>;

/** Who actually put money down. Supports multiple payers on one bill. */
export type Payments = Record<UserId, Minor>;

export interface Transfer {
  from: UserId;
  to: UserId;
  amountMinor: Minor;
}
