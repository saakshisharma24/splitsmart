import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  getDate,
  isAfter,
  lastDayOfMonth,
  setDate,
  startOfDay,
} from 'date-fns';

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RecurrenceRule {
  frequency: Frequency;
  /** Fire every N periods. 2 + MONTHLY = every other month. */
  interval: number;
  /** The rule's anchor. For monthly rules, its day-of-month is the anchor day. */
  startDate: Date;
  endDate?: Date | null;
}

/**
 * The next time a rule should fire, strictly after `after`.
 *
 * The interesting case is monthly rules anchored to a day that not every month
 * has. Rent due on the 31st should fire on 28 Feb, then on 31 Mar - not drift
 * to the 28th of every subsequent month, which is what you get if you compute
 * each occurrence from the previous one. So occurrences are always computed
 * from the original startDate anchor, and clamped to the target month's length.
 */
export function nextOccurrence(rule: RecurrenceRule, after: Date): Date | null {
  const interval = Math.max(1, Math.floor(rule.interval));
  const start = startOfDay(rule.startDate);
  const cursor = startOfDay(after);

  // A rule that has not started yet fires first at its start date.
  if (!isAfter(cursor, start) && cursor.getTime() !== start.getTime()) {
    return withinEnd(start, rule);
  }

  let next: Date;
  switch (rule.frequency) {
    case 'DAILY': {
      const periods = Math.floor(daysBetween(start, cursor) / interval) + 1;
      next = addDays(start, periods * interval);
      break;
    }
    case 'WEEKLY': {
      const periods = Math.floor(daysBetween(start, cursor) / (7 * interval)) + 1;
      next = addWeeks(start, periods * interval);
      break;
    }
    case 'MONTHLY': {
      const anchorDay = getDate(start);
      // Jump straight to roughly the right month, then step by whole intervals
      // until we are past `after`. Every candidate is computed from `start`,
      // never from the previous occurrence, so a clamped short month (Feb 28)
      // does not drag every later month back with it.
      let periods = ceilToInterval(Math.max(0, monthsBetween(start, cursor)), interval);
      next = clampToMonth(addMonths(start, periods), anchorDay);
      while (!isAfter(next, cursor)) {
        periods += interval;
        next = clampToMonth(addMonths(start, periods), anchorDay);
      }
      break;
    }
    case 'YEARLY': {
      const anchorDay = getDate(start);
      let periods = ceilToInterval(
        Math.max(0, cursor.getFullYear() - start.getFullYear()),
        interval,
      );
      next = clampToMonth(addYears(start, periods), anchorDay);
      while (!isAfter(next, cursor)) {
        periods += interval;
        next = clampToMonth(addYears(start, periods), anchorDay);
      }
      break;
    }
    default: {
      const exhaustive: never = rule.frequency;
      throw new Error(`Unknown frequency: ${String(exhaustive)}`);
    }
  }

  return withinEnd(next, rule);
}

/**
 * Every occurrence a rule owes between `from` and `now`.
 *
 * This is the catch-up path: the app has no always-on cron, so when a group is
 * opened the scheduler asks each active rule what it missed while nobody was
 * looking. A flatmate who does not open the app for three months still comes
 * back to three rent expenses, dated correctly, not one dated today.
 *
 * `limit` is a safety rail against a misconfigured daily rule with a start date
 * years in the past generating thousands of rows in one request.
 */
export function dueOccurrences(
  rule: RecurrenceRule,
  from: Date,
  now: Date = new Date(),
  limit = 60,
): Date[] {
  const out: Date[] = [];
  let cursor = addDays(startOfDay(from), -1); // so an occurrence exactly on `from` counts

  for (let i = 0; i < limit; i++) {
    const next = nextOccurrence(rule, cursor);
    if (!next || isAfter(next, now)) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

/** Plain-English description for the rule list: "Every 2 weeks", "Monthly on the 5th". */
export function describeRule(rule: RecurrenceRule): string {
  const n = Math.max(1, Math.floor(rule.interval));
  const day = getDate(rule.startDate);
  switch (rule.frequency) {
    case 'DAILY':
      return n === 1 ? 'Every day' : `Every ${n} days`;
    case 'WEEKLY':
      return n === 1 ? 'Every week' : `Every ${n} weeks`;
    case 'MONTHLY':
      return n === 1 ? `Monthly on the ${ordinal(day)}` : `Every ${n} months on the ${ordinal(day)}`;
    case 'YEARLY':
      return n === 1 ? 'Every year' : `Every ${n} years`;
    default:
      return 'Repeats';
  }
}

function withinEnd(d: Date, rule: RecurrenceRule): Date | null {
  if (rule.endDate && isAfter(startOfDay(d), startOfDay(rule.endDate))) return null;
  return d;
}

/** Round up to the next whole multiple of `interval`. */
function ceilToInterval(n: number, interval: number): number {
  return Math.ceil(n / interval) * interval;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/** Put `day` in the given month, falling back to that month's last day. */
function clampToMonth(d: Date, day: number): Date {
  const last = getDate(lastDayOfMonth(d));
  return startOfDay(setDate(d, Math.min(day, last)));
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
