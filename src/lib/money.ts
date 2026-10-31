/**
 * Money is NEVER a float in this codebase.
 *
 * Every amount is stored and passed around as an integer number of *minor
 * units* (paise for INR, cents for USD). `12.35` becomes `1235`. This is the
 * single most important invariant in the app: floating point cannot represent
 * 0.1, so `0.1 + 0.2 !== 0.3`, and a bill-splitting app that loses a paise per
 * expense will drift until the balances stop reconciling.
 */

export type Minor = number;

/** Minor units per major unit, keyed by ISO 4217 code. */
const EXPONENTS: Record<string, number> = {
  INR: 2, USD: 2, EUR: 2, GBP: 2, AUD: 2, CAD: 2, SGD: 2, AED: 2,
  JPY: 0, KRW: 0, VND: 0,
  BHD: 3, KWD: 3, OMR: 3,
};

const SYMBOLS: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  AUD: 'A$', CAD: 'C$', SGD: 'S$', AED: 'AED ', KRW: '₩',
};

export function exponentOf(currency: string): number {
  const e = EXPONENTS[currency.toUpperCase()];
  return e === undefined ? 2 : e;
}

export function symbolOf(currency: string): string {
  return SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
}

/**
 * Parse human input ("1,234.50", "₹1234.5", "12") into minor units.
 * Throws on anything it cannot read exactly - we never silently round input.
 */
export function parseMoney(input: string | number, currency = 'INR'): Minor {
  const exp = exponentOf(currency);
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new RangeError('Amount is not a finite number');
    return Math.round(input * 10 ** exp);
  }
  const cleaned = input.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') {
    throw new SyntaxError(`Cannot parse "${input}" as an amount`);
  }
  if ((cleaned.match(/\./g) ?? []).length > 1) {
    throw new SyntaxError(`Cannot parse "${input}" as an amount`);
  }
  const negative = cleaned.startsWith('-');
  const [whole, frac = ''] = cleaned.replace('-', '').split('.');
  // Pad/truncate the fraction to the currency's exponent, rounding half-up.
  const padded = frac.padEnd(exp + 1, '0');
  const kept = padded.slice(0, exp);
  const nextDigit = Number(padded[exp] ?? '0');
  let minor = Number(whole || '0') * 10 ** exp + Number(kept || '0');
  if (nextDigit >= 5) minor += 1;
  return negative ? -minor : minor;
}

/** Render minor units for display: 123456 -> "1,234.56". */
export function formatMinor(minor: Minor, currency = 'INR'): string {
  const exp = exponentOf(currency);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** exp);
  const frac = abs % 10 ** exp;
  const grouped = whole.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US');
  const body = exp === 0 ? grouped : `${grouped}.${String(frac).padStart(exp, '0')}`;
  return negative ? `-${body}` : body;
}

/** Render with the currency symbol attached: "₹1,234.56". */
export function formatMoney(minor: Minor, currency = 'INR'): string {
  const negative = minor < 0;
  const body = formatMinor(Math.abs(minor), currency);
  return `${negative ? '-' : ''}${symbolOf(currency)}${body}`;
}

/**
 * Split `total` across `weights` so the parts sum to EXACTLY `total`.
 *
 * Uses the largest-remainder (Hamilton) method: give everyone their floored
 * share, then hand the leftover units out one at a time to whoever was robbed
 * hardest by the flooring. Ties break by index so the result is deterministic -
 * the same expense always splits the same way, which matters because users
 * re-open old bills and expect the numbers not to move.
 *
 * Example: 100 paise across 3 equal people -> [34, 33, 33], never [33,33,33].
 */
export function allocateByWeight(total: Minor, weights: number[]): Minor[] {
  const n = weights.length;
  if (n === 0) {
    if (total !== 0) throw new RangeError('Cannot allocate a non-zero total across zero parts');
    return [];
  }
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) {
    throw new RangeError('Weights must be finite and non-negative');
  }

  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    // Degenerate: everyone has zero weight. Fall back to an even split so we
    // still return something that adds up rather than dividing by zero.
    return allocateByWeight(total, weights.map(() => 1));
  }

  // Work on the absolute value so flooring behaves the same for refunds.
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);

  const exact = weights.map((w) => (abs * w) / sum);
  const base = exact.map((x) => Math.floor(x));
  let remainder = abs - base.reduce((a, b) => a + b, 0);

  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));

  const out = base.slice();
  for (let k = 0; remainder > 0; k++, remainder--) {
    out[order[k % n].i] += 1;
  }
  return out.map((v) => v * sign);
}

/** Equal split that still sums exactly: the classic ₹100 / 3 problem. */
export function allocateEqually(total: Minor, parts: number): Minor[] {
  return allocateByWeight(total, new Array(parts).fill(1));
}

export function sum(values: Minor[]): Minor {
  return values.reduce((a, b) => a + b, 0);
}

/** Guard used at every boundary where an amount enters the system. */
export function assertMinor(value: unknown, label = 'amount'): Minor {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer in minor units, got ${String(value)}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} exceeds the safe integer range`);
  }
  return value;
}
