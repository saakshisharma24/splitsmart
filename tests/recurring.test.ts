import { describe, expect, it } from 'vitest';
import { describeRule, dueOccurrences, nextOccurrence, type RecurrenceRule } from '@/lib/recurring/schedule';

const d = (s: string) => new Date(`${s}T00:00:00`);
// Format in LOCAL time. toISOString() converts to UTC, which in any timezone
// east of Greenwich turns local midnight into the previous day's date.
const iso = (x: Date | null) =>
  x
    ? `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    : null;

describe('nextOccurrence - monthly', () => {
  it('fires on the anchor day each month', () => {
    const rule: RecurrenceRule = { frequency: 'MONTHLY', interval: 1, startDate: d('2026-01-05') };
    expect(iso(nextOccurrence(rule, d('2026-01-05')))).toBe('2026-02-05');
    expect(iso(nextOccurrence(rule, d('2026-02-10')))).toBe('2026-03-05');
  });

  it('clamps to the last day of a short month, then recovers', () => {
    // Rent due on the 31st. February has no 31st - but March does, and the
    // rule must NOT drift to the 28th forever.
    const rule: RecurrenceRule = { frequency: 'MONTHLY', interval: 1, startDate: d('2026-01-31') };
    expect(iso(nextOccurrence(rule, d('2026-01-31')))).toBe('2026-02-28');
    expect(iso(nextOccurrence(rule, d('2026-02-28')))).toBe('2026-03-31');
    expect(iso(nextOccurrence(rule, d('2026-03-31')))).toBe('2026-04-30');
    expect(iso(nextOccurrence(rule, d('2026-04-30')))).toBe('2026-05-31');
  });

  it('handles a leap year', () => {
    const rule: RecurrenceRule = { frequency: 'MONTHLY', interval: 1, startDate: d('2028-01-31') };
    expect(iso(nextOccurrence(rule, d('2028-01-31')))).toBe('2028-02-29');
  });

  it('supports every-other-month', () => {
    const rule: RecurrenceRule = { frequency: 'MONTHLY', interval: 2, startDate: d('2026-01-15') };
    expect(iso(nextOccurrence(rule, d('2026-01-15')))).toBe('2026-03-15');
    expect(iso(nextOccurrence(rule, d('2026-03-15')))).toBe('2026-05-15');
  });
});

describe('nextOccurrence - other frequencies', () => {
  it('daily and weekly', () => {
    expect(iso(nextOccurrence({ frequency: 'DAILY', interval: 1, startDate: d('2026-03-01') }, d('2026-03-04')))).toBe('2026-03-05');
    expect(iso(nextOccurrence({ frequency: 'WEEKLY', interval: 1, startDate: d('2026-03-02') }, d('2026-03-02')))).toBe('2026-03-09');
    expect(iso(nextOccurrence({ frequency: 'WEEKLY', interval: 2, startDate: d('2026-03-02') }, d('2026-03-02')))).toBe('2026-03-16');
  });

  it('yearly, including 29 Feb', () => {
    expect(iso(nextOccurrence({ frequency: 'YEARLY', interval: 1, startDate: d('2026-06-10') }, d('2026-06-10')))).toBe('2027-06-10');
    const leap: RecurrenceRule = { frequency: 'YEARLY', interval: 1, startDate: d('2028-02-29') };
    expect(iso(nextOccurrence(leap, d('2028-02-29')))).toBe('2029-02-28');
  });

  it('returns the start date when the rule has not begun yet', () => {
    const rule: RecurrenceRule = { frequency: 'MONTHLY', interval: 1, startDate: d('2026-12-01') };
    expect(iso(nextOccurrence(rule, d('2026-06-01')))).toBe('2026-12-01');
  });

  it('stops at the end date', () => {
    const rule: RecurrenceRule = {
      frequency: 'MONTHLY', interval: 1, startDate: d('2026-01-10'), endDate: d('2026-03-31'),
    };
    expect(iso(nextOccurrence(rule, d('2026-02-10')))).toBe('2026-03-10');
    expect(nextOccurrence(rule, d('2026-03-10'))).toBeNull();
  });
});

describe('dueOccurrences - the catch-up path', () => {
  it('generates everything missed while nobody opened the app', () => {
    // Rent from January; the app is opened in April.
    const rule: RecurrenceRule = { frequency: 'MONTHLY', interval: 1, startDate: d('2026-01-01') };
    const due = dueOccurrences(rule, d('2026-01-01'), d('2026-04-15'));
    expect(due.map(iso)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
  });

  it('does not re-fire what has already been generated', () => {
    const rule: RecurrenceRule = { frequency: 'MONTHLY', interval: 1, startDate: d('2026-01-01') };
    const due = dueOccurrences(rule, d('2026-03-02'), d('2026-04-15'));
    expect(due.map(iso)).toEqual(['2026-04-01']);
  });

  it('returns nothing when the rule is up to date', () => {
    const rule: RecurrenceRule = { frequency: 'MONTHLY', interval: 1, startDate: d('2026-01-01') };
    expect(dueOccurrences(rule, d('2026-04-02'), d('2026-04-15'))).toEqual([]);
  });

  it('caps runaway generation', () => {
    // A daily rule started five years ago must not produce 1800 expenses.
    const rule: RecurrenceRule = { frequency: 'DAILY', interval: 1, startDate: d('2021-01-01') };
    expect(dueOccurrences(rule, d('2021-01-01'), d('2026-01-01')).length).toBe(60);
  });

  it('respects the end date while catching up', () => {
    const rule: RecurrenceRule = {
      frequency: 'MONTHLY', interval: 1, startDate: d('2026-01-01'), endDate: d('2026-02-28'),
    };
    expect(dueOccurrences(rule, d('2026-01-01'), d('2026-06-01')).map(iso)).toEqual([
      '2026-01-01', '2026-02-01',
    ]);
  });
});

describe('describeRule', () => {
  it('reads like English', () => {
    expect(describeRule({ frequency: 'MONTHLY', interval: 1, startDate: d('2026-01-05') })).toBe('Monthly on the 5th');
    expect(describeRule({ frequency: 'MONTHLY', interval: 1, startDate: d('2026-01-01') })).toBe('Monthly on the 1st');
    expect(describeRule({ frequency: 'MONTHLY', interval: 1, startDate: d('2026-01-22') })).toBe('Monthly on the 22nd');
    expect(describeRule({ frequency: 'MONTHLY', interval: 1, startDate: d('2026-01-03') })).toBe('Monthly on the 3rd');
    expect(describeRule({ frequency: 'MONTHLY', interval: 1, startDate: d('2026-01-11') })).toBe('Monthly on the 11th');
    expect(describeRule({ frequency: 'WEEKLY', interval: 2, startDate: d('2026-01-05') })).toBe('Every 2 weeks');
    expect(describeRule({ frequency: 'DAILY', interval: 1, startDate: d('2026-01-05') })).toBe('Every day');
  });
});
