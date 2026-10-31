import { sum, type Minor } from '../money';
import type { UserId } from '../split/types';

/** The flat shape every analytics function reads. Built once from the DB rows. */
export interface ExpenseRecord {
  id: string;
  description: string;
  category: string;
  totalMinor: Minor;
  date: Date;
  payments: Record<UserId, Minor>;
  shares: Record<UserId, Minor>;
}

export interface CategorySlice {
  category: string;
  totalMinor: Minor;
  count: number;
  /** Fraction of total spend, 0-1. */
  share: number;
}

export interface MonthPoint {
  /** 'YYYY-MM', sortable and stable across timezones. */
  month: string;
  label: string;
  totalMinor: Minor;
  /** Just the viewer's share of that month, when a viewer is given. */
  yourShareMinor: Minor;
  count: number;
}

export interface MemberSlice {
  userId: UserId;
  paidMinor: Minor;
  owedMinor: Minor;
  /** paid - owed. Positive means they have fronted more than their share. */
  netMinor: Minor;
  expenseCount: number;
}

export interface GroupAnalytics {
  totalMinor: Minor;
  expenseCount: number;
  averageMinor: Minor;
  largest: ExpenseRecord | null;
  byCategory: CategorySlice[];
  byMonth: MonthPoint[];
  byMember: MemberSlice[];
  /** The viewer's own share of everything, when a viewer is given. */
  yourShareMinor: Minor;
  busiestMonth: MonthPoint | null;
  topCategory: CategorySlice | null;
}

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Local-time month key. toISOString() would bucket a 1 Jan expense into December. */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function analyseGroup(
  expenses: ExpenseRecord[],
  members: UserId[],
  viewer?: UserId,
): GroupAnalytics {
  const totalMinor = sum(expenses.map((e) => e.totalMinor));

  // --- categories ---
  const catMap = new Map<string, { total: Minor; count: number }>();
  for (const e of expenses) {
    const c = catMap.get(e.category) ?? { total: 0, count: 0 };
    c.total += e.totalMinor;
    c.count += 1;
    catMap.set(e.category, c);
  }
  const byCategory: CategorySlice[] = [...catMap.entries()]
    .map(([category, v]) => ({
      category,
      totalMinor: v.total,
      count: v.count,
      share: totalMinor === 0 ? 0 : v.total / totalMinor,
    }))
    .sort((a, b) => b.totalMinor - a.totalMinor || a.category.localeCompare(b.category));

  // --- months ---
  const monthMap = new Map<string, { total: Minor; yours: Minor; count: number }>();
  for (const e of expenses) {
    const k = monthKey(e.date);
    const m = monthMap.get(k) ?? { total: 0, yours: 0, count: 0 };
    m.total += e.totalMinor;
    m.yours += viewer ? (e.shares[viewer] ?? 0) : 0;
    m.count += 1;
    monthMap.set(k, m);
  }
  const byMonth: MonthPoint[] = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => {
      const [y, mm] = month.split('-');
      return {
        month,
        label: `${MONTH_LABELS[Number(mm) - 1]} ${y.slice(2)}`,
        totalMinor: v.total,
        yourShareMinor: v.yours,
        count: v.count,
      };
    });

  // --- members ---
  const byMember: MemberSlice[] = members
    .map((userId) => {
      let paid = 0;
      let owed = 0;
      let count = 0;
      for (const e of expenses) {
        const p = e.payments[userId] ?? 0;
        const o = e.shares[userId] ?? 0;
        paid += p;
        owed += o;
        if (p !== 0 || o !== 0) count += 1;
      }
      return { userId, paidMinor: paid, owedMinor: owed, netMinor: paid - owed, expenseCount: count };
    })
    .sort((a, b) => b.owedMinor - a.owedMinor);

  const largest = expenses.length
    ? expenses.reduce((a, b) => (b.totalMinor > a.totalMinor ? b : a))
    : null;

  return {
    totalMinor,
    expenseCount: expenses.length,
    // Integer division keeps the average in whole minor units.
    averageMinor: expenses.length === 0 ? 0 : Math.round(totalMinor / expenses.length),
    largest,
    byCategory,
    byMonth,
    byMember,
    yourShareMinor: viewer ? sum(expenses.map((e) => e.shares[viewer] ?? 0)) : 0,
    busiestMonth: byMonth.length
      ? byMonth.reduce((a, b) => (b.totalMinor > a.totalMinor ? b : a))
      : null,
    topCategory: byCategory[0] ?? null,
  };
}

export const CATEGORIES = [
  'FOOD', 'GROCERIES', 'RENT', 'UTILITIES', 'TRANSPORT', 'TRAVEL',
  'ENTERTAINMENT', 'SHOPPING', 'HEALTH', 'SUBSCRIPTIONS', 'OTHER',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_META: Record<string, { label: string; emoji: string; color: string }> = {
  FOOD:          { label: 'Food & drink',  emoji: '\u{1F37D}\u{FE0F}', color: '#f97316' },
  GROCERIES:     { label: 'Groceries',     emoji: '\u{1F6D2}', color: '#84cc16' },
  RENT:          { label: 'Rent',          emoji: '\u{1F3E0}', color: '#6366f1' },
  UTILITIES:     { label: 'Utilities',     emoji: '\u{1F4A1}', color: '#eab308' },
  TRANSPORT:     { label: 'Transport',     emoji: '\u{1F698}', color: '#06b6d4' },
  TRAVEL:        { label: 'Travel',        emoji: '\u{2708}\u{FE0F}', color: '#0ea5e9' },
  ENTERTAINMENT: { label: 'Entertainment', emoji: '\u{1F3AC}', color: '#ec4899' },
  SHOPPING:      { label: 'Shopping',      emoji: '\u{1F6CD}\u{FE0F}', color: '#a855f7' },
  HEALTH:        { label: 'Health',        emoji: '\u{1F48A}', color: '#ef4444' },
  SUBSCRIPTIONS: { label: 'Subscriptions', emoji: '\u{1F501}', color: '#14b8a6' },
  OTHER:         { label: 'Other',         emoji: '\u{1F4CC}', color: '#64748b' },
};

export function categoryMeta(c: string) {
  return CATEGORY_META[c] ?? CATEGORY_META.OTHER;
}
