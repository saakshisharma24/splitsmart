import { describe, expect, it } from 'vitest';
import { analyseGroup, categoryMeta, type ExpenseRecord } from '@/lib/analytics/summarize';
import { buildCsv } from '@/lib/export/workbook';
import { allocate } from '@/lib/split/allocate';

const members = ['ari', 'sam', 'priya'];
const mk = (
  id: string, description: string, category: string, total: number, dateStr: string, payer: string,
): ExpenseRecord => ({
  id,
  description,
  category,
  totalMinor: total,
  date: new Date(`${dateStr}T12:00:00`),
  payments: { [payer]: total },
  shares: allocate(total, { mode: 'EQUAL', participants: members }),
});

const expenses: ExpenseRecord[] = [
  mk('1', 'Dinner at Toit',   'FOOD',      300000, '2026-01-14', 'ari'),
  mk('2', 'January rent',     'RENT',     4500000, '2026-01-01', 'sam'),
  mk('3', 'Weekly groceries', 'GROCERIES', 180000, '2026-01-20', 'priya'),
  mk('4', 'February rent',    'RENT',     4500000, '2026-02-01', 'sam'),
  mk('5', 'Cab to airport',   'TRANSPORT', 90000,  '2026-02-11', 'ari'),
];

describe('analyseGroup', () => {
  const a = analyseGroup(expenses, members, 'ari');

  it('totals everything', () => {
    expect(a.totalMinor).toBe(9570000);
    expect(a.expenseCount).toBe(5);
    expect(a.averageMinor).toBe(1914000);
  });

  it('ranks categories by spend', () => {
    expect(a.byCategory[0].category).toBe('RENT');
    expect(a.byCategory[0].totalMinor).toBe(9000000);
    expect(a.byCategory[0].count).toBe(2);
    expect(a.byCategory[0].share).toBeCloseTo(9000000 / 9570000, 6);
    expect(a.topCategory?.category).toBe('RENT');
  });

  it('buckets by month in local time, oldest first', () => {
    expect(a.byMonth.map((m) => m.month)).toEqual(['2026-01', '2026-02']);
    expect(a.byMonth[0].label).toBe('Jan 26');
    expect(a.byMonth[0].totalMinor).toBe(4980000);
    expect(a.byMonth[1].totalMinor).toBe(4590000);
  });

  it('tracks the viewer"s own share separately from group spend', () => {
    // Everything is split three ways, so Ari's share is a third of the total.
    expect(a.yourShareMinor).toBe(3190000);
    expect(a.byMonth[0].yourShareMinor).toBe(1660000);
  });

  it('breaks down paid vs owed per member', () => {
    const sam = a.byMember.find((m) => m.userId === 'sam');
    expect(sam?.paidMinor).toBe(9000000);
    expect(sam?.owedMinor).toBe(3190000);
    expect(sam?.netMinor).toBe(5810000);
    // Net across everybody is always zero.
    expect(a.byMember.reduce((t, m) => t + m.netMinor, 0)).toBe(0);
  });

  it('finds the largest expense', () => {
    expect(a.largest?.totalMinor).toBe(4500000);
    expect(a.busiestMonth?.month).toBe('2026-01');
  });

  it('copes with an empty group', () => {
    const empty = analyseGroup([], members);
    expect(empty.totalMinor).toBe(0);
    expect(empty.averageMinor).toBe(0);
    expect(empty.largest).toBeNull();
    expect(empty.topCategory).toBeNull();
    expect(empty.byMember.every((m) => m.netMinor === 0)).toBe(true);
  });

  it('falls back to Other for an unknown category', () => {
    expect(categoryMeta('NOT_A_CATEGORY').label).toBe('Other');
    expect(categoryMeta('RENT').label).toBe('Rent');
  });
});

describe('buildCsv', () => {
  const csv = buildCsv({
    groupName: 'Flat 302',
    currency: 'INR',
    members: members.map((id) => ({ id, name: id.toUpperCase() })),
    expenses,
    analytics: analyseGroup(expenses, members),
    settleUp: [],
    settlements: [],
  });

  it('writes a header with a column per member', () => {
    expect(csv.split('\n')[0]).toBe(
      'Date,Description,Category,Total (INR),Paid by,ARI owes,SAM owes,PRIYA owes',
    );
  });

  it('writes amounts as plain numbers a spreadsheet can total', () => {
    const rent = csv.split('\n').find((l) => l.includes('January rent'));
    expect(rent).toContain('45000.00');
    expect(rent).toContain('SAM');
  });

  it('escapes a description containing a comma', () => {
    const tricky = buildCsv({
      groupName: 'g', currency: 'INR',
      members: [{ id: 'ari', name: 'Ari' }],
      expenses: [mk('x', 'Dinner, drinks and dessert', 'FOOD', 1000, '2026-01-01', 'ari')],
      analytics: analyseGroup([], ['ari']), settleUp: [], settlements: [],
    });
    expect(tricky).toContain('"Dinner, drinks and dessert"');
  });
});
