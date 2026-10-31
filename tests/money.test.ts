import { describe, expect, it } from 'vitest';
import {
  allocateByWeight,
  allocateEqually,
  formatMinor,
  formatMoney,
  parseMoney,
  sum,
} from '@/lib/money';

describe('parseMoney', () => {
  it('reads plain and decorated amounts', () => {
    expect(parseMoney('1234.56')).toBe(123456);
    expect(parseMoney('1,234.56')).toBe(123456);
    expect(parseMoney('₹1,234.56')).toBe(123456);
    expect(parseMoney('12')).toBe(1200);
    expect(parseMoney('0.5')).toBe(50);
  });

  it('rounds half-up past the currency exponent', () => {
    expect(parseMoney('1.005')).toBe(101);
    expect(parseMoney('1.004')).toBe(100);
  });

  it('respects currencies that are not two-decimal', () => {
    expect(parseMoney('1234', 'JPY')).toBe(1234);
    expect(parseMoney('1.234', 'KWD')).toBe(1234);
  });

  it('refuses input it cannot read exactly', () => {
    expect(() => parseMoney('abc')).toThrow();
    expect(() => parseMoney('1.2.3')).toThrow();
    expect(() => parseMoney(Number.NaN)).toThrow();
  });

  it('survives the float trap that motivates this whole module', () => {
    // 0.1 + 0.2 !== 0.3 in float. In minor units it is just 10 + 20 === 30.
    expect(parseMoney('0.1') + parseMoney('0.2')).toBe(parseMoney('0.3'));
  });
});

describe('formatting', () => {
  it('renders minor units back to human text', () => {
    expect(formatMinor(123456)).toBe('1,234.56');
    // INR groups the Indian way once you pass a lakh: 12,34,567.89
    expect(formatMinor(123456789, 'INR')).toBe('12,34,567.89');
    expect(formatMinor(5)).toBe('0.05');
    expect(formatMinor(-250)).toBe('-2.50');
    expect(formatMoney(123456, 'USD')).toBe('$1,234.56');
    expect(formatMoney(-500, 'USD')).toBe('-$5.00');
    expect(formatMoney(1234, 'JPY')).toBe('¥1,234');
  });

  it('round-trips through parse', () => {
    for (const v of [0, 1, 99, 100, 123456, 9999999]) {
      expect(parseMoney(formatMinor(v))).toBe(v);
    }
  });
});

describe('allocateByWeight', () => {
  it('never loses or invents a unit', () => {
    expect(allocateEqually(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(sum(allocateEqually(10000, 3))).toBe(10000);
    expect(sum(allocateEqually(1, 7))).toBe(1);
    expect(sum(allocateEqually(0, 5))).toBe(0);
  });

  it('hands leftovers to the largest remainders, deterministically', () => {
    // 100 across weights 1:1:1 -> remainder 1 goes to index 0 on a tie.
    expect(allocateByWeight(100, [1, 1, 1])).toEqual([34, 33, 33]);
    // Same input, same output, every time - users re-open old expenses.
    for (let i = 0; i < 20; i++) {
      expect(allocateByWeight(100, [1, 1, 1])).toEqual([34, 33, 33]);
    }
  });

  it('weights proportionally', () => {
    expect(allocateByWeight(300, [2, 1])).toEqual([200, 100]);
    expect(allocateByWeight(100, [3, 1])).toEqual([75, 25]);
  });

  it('handles refunds (negative totals) without drifting', () => {
    const parts = allocateByWeight(-10000, [1, 1, 1]);
    expect(sum(parts)).toBe(-10000);
    expect(parts.every((p) => p <= 0)).toBe(true);
  });

  it('falls back to an even split when every weight is zero', () => {
    expect(sum(allocateByWeight(100, [0, 0, 0]))).toBe(100);
  });

  it('holds the sum invariant across a few thousand random cases', () => {
    let seed = 42;
    const rnd = () => {
      // Deterministic LCG - a failing case can actually be reproduced.
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 3000; i++) {
      const n = 1 + Math.floor(rnd() * 12);
      const total = Math.floor(rnd() * 5_000_000) - 1_000_000;
      const weights = Array.from({ length: n }, () => Math.floor(rnd() * 100));
      expect(sum(allocateByWeight(total, weights))).toBe(total);
    }
  });

  it('rejects nonsense weights', () => {
    expect(() => allocateByWeight(100, [-1, 2])).toThrow();
    expect(() => allocateByWeight(100, [Number.NaN])).toThrow();
    expect(() => allocateByWeight(100, [])).toThrow();
  });
});
