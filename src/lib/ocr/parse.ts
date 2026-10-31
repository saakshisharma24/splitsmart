import { parseMoney, type Minor } from '../money';

/**
 * Turns the raw text Tesseract pulls off a receipt photo into structured line
 * items.
 *
 * Deliberately separated from the OCR step itself: OCR needs an image, a
 * worker and ~2 seconds, while this is a pure string->object function that can
 * be unit tested against a hundred real receipt dumps in milliseconds. Nearly
 * all the actual difficulty lives here, not in Tesseract.
 */

export interface ParsedItem {
  label: string;
  amountMinor: Minor;
  quantity: number;
  /** Line this came from, so the UI can show the user what it matched. */
  sourceLine: string;
}

export interface ParsedReceipt {
  items: ParsedItem[];
  subtotalMinor: Minor | null;
  taxMinor: Minor;
  tipMinor: Minor;
  discountMinor: Minor;
  /** The total printed on the receipt, if one was found. */
  totalMinor: Minor | null;
  merchant: string | null;
  date: string | null;
  /** 0-1. Low confidence means "show this to the user before trusting it". */
  confidence: number;
  /** Human-readable notes about anything that did not reconcile. */
  warnings: string[];
}

// Lines that are a bill-level figure rather than something somebody ate.
const TAX_WORDS = /\b(gst|cgst|sgst|igst|vat|tax|service\s*tax)\b/i;
const TIP_WORDS = /\b(tip|gratuity|service\s*(charge|chrg)|svc\s*chg)\b/i;
const DISCOUNT_WORDS = /\b(discount|disc|off|promo|coupon|savings?)\b/i;
const SUBTOTAL_WORDS = /\b(sub\s*total|subtotal|sub-total)\b/i;
const TOTAL_WORDS = /\b(grand\s*total|total\s*(amount|payable|due)?|amount\s*(payable|due)|net\s*payable|balance\s*due)\b/i;
const NOISE_WORDS =
  /\b(invoice|bill\s*no|receipt|order\s*(no|id)|table|gstin|fssai|thank\s*you|visit\s*again|cashier|server|phone|tel|www\.|\.com|address|terms|copy|pan\b|cin\b|tin\b)/i;
const PAYMENT_WORDS = /\b(cash|card|upi|change|tendered|paid|visa|mastercard|rupay|paytm|gpay|phonepe)\b/i;
// The shop's own address sits right under the merchant name and ends in a
// 6-digit PIN, which reads exactly like a large price if you let it.
const ADDRESS_WORDS =
  /\b(road|rd\.?|street|st\.?|lane|marg|nagar|layout|cross|block|floor|sector|phase|colony|opp\.?|near|plot|shop\s*no)\b/i;
const PIN_OR_PHONE = /\b\d{6,}\b/;

/**
 * An amount at the end of a line. Accepts 1,234.56 / 1234.56 / 1234 / 1234.5
 * and tolerates a leading currency mark, a trailing minus, or a trailing "-"
 * which Indian receipts often print after a figure.
 */
const TRAILING_AMOUNT = /(?:^|\s)(?:[₹$€£]\s?)?(-?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})?)\s*(-|CR|DR)?\s*$/i;

/** "2 x Paneer Tikka", "2x Paneer", "2 Paneer Tikka", "Paneer Tikka x2". */
const LEADING_QTY = /^(\d{1,3})\s*(?:x|\*|×)?\s+(.{2,})$/i;
const TRAILING_QTY = /^(.{2,}?)\s*(?:x|\*|×)\s*(\d{1,3})$/i;

const DATE_PATTERNS = [
  /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/,
  /\b(\d{4}-\d{2}-\d{2})\b/,
];

function safeParse(raw: string, currency: string): Minor | null {
  try {
    const v = parseMoney(raw, currency);
    // A receipt line in the crores is almost certainly OCR noise (a phone
    // number or a GSTIN that happened to end the line).
    if (Math.abs(v) > 100_000_000) return null;
    return v;
  } catch {
    return null;
  }
}

/**
 * Is this trailing number actually a price, or is it a PIN code, a phone
 * number or an invoice number?
 *
 * The signal that works: real prices are either written with decimals, or are
 * small. "560001" with no decimal point is a Bengaluru PIN code, not a 5.6
 * lakh plate of paneer. Applied to candidate item lines only - a genuine grand
 * total is allowed to be large, because it was already identified by keyword.
 */
function looksLikeAnItemPrice(rawAmount: string, line: string): boolean {
  const hasDecimals = rawAmount.includes('.');
  const digits = rawAmount.replace(/[^0-9]/g, '').length;
  if (!hasDecimals && digits >= 5) return false;
  if (ADDRESS_WORDS.test(line) && PIN_OR_PHONE.test(line)) return false;
  return true;
}

export function parseReceiptText(text: string, currency = 'INR'): ParsedReceipt {
  const warnings: string[] = [];
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0);

  const items: ParsedItem[] = [];
  let subtotalMinor: Minor | null = null;
  let totalMinor: Minor | null = null;
  let taxMinor = 0;
  let tipMinor = 0;
  let discountMinor = 0;
  let merchant: string | null = null;
  let date: string | null = null;

  // The merchant name is nearly always the first line with letters and no price.
  for (const line of rawLines.slice(0, 4)) {
    if (/[A-Za-z]{3,}/.test(line) && !TRAILING_AMOUNT.test(line) && !NOISE_WORDS.test(line)) {
      merchant = line.replace(/[^\w\s&'.-]/g, '').trim() || null;
      break;
    }
  }

  for (const line of rawLines) {
    if (!date) {
      for (const p of DATE_PATTERNS) {
        const m = line.match(p);
        if (m) {
          date = m[1];
          break;
        }
      }
    }

    const amountMatch = line.match(TRAILING_AMOUNT);
    if (!amountMatch) continue;

    let amount = safeParse(amountMatch[1], currency);
    if (amount === null) continue;
    // "250-" and "250 CR" both mean a credit on Indian printouts.
    if (amountMatch[2] && /^(-|CR)$/i.test(amountMatch[2])) amount = -Math.abs(amount);

    const label = line.slice(0, amountMatch.index ?? line.length).trim().replace(/[.:\-•]+$/, '').trim();

    // Classify the line. Order matters: subtotal and total both contain
    // "total", and discount lines often contain a tax word too.
    if (SUBTOTAL_WORDS.test(line)) {
      subtotalMinor = Math.abs(amount);
      continue;
    }
    if (DISCOUNT_WORDS.test(line)) {
      discountMinor += Math.abs(amount);
      continue;
    }
    if (TIP_WORDS.test(line)) {
      tipMinor += Math.abs(amount);
      continue;
    }
    if (TAX_WORDS.test(line)) {
      taxMinor += Math.abs(amount);
      continue;
    }
    if (TOTAL_WORDS.test(line)) {
      // Keep the largest "total" seen; receipts print several near the end.
      const v = Math.abs(amount);
      totalMinor = totalMinor === null ? v : Math.max(totalMinor, v);
      continue;
    }
    if (PAYMENT_WORDS.test(line) || NOISE_WORDS.test(line)) continue;

    // Anything left with a real label is treated as something somebody ordered.
    if (label.length < 2 || !/[A-Za-z]{2,}/.test(label)) continue;
    if (amount <= 0) continue;
    if (!looksLikeAnItemPrice(amountMatch[1], line)) continue;

    let quantity = 1;
    let cleanLabel = label;
    const lead = label.match(LEADING_QTY);
    const trail = label.match(TRAILING_QTY);
    if (lead) {
      quantity = Number(lead[1]);
      cleanLabel = lead[2].trim();
    } else if (trail) {
      cleanLabel = trail[1].trim();
      quantity = Number(trail[2]);
    }
    if (quantity < 1 || quantity > 99) quantity = 1;

    items.push({ label: cleanLabel, amountMinor: amount, quantity, sourceLine: line });
  }

  // Reconcile. This is what tells the user whether to trust the scan.
  const itemsSum = items.reduce((a, i) => a + i.amountMinor, 0);
  let confidence = items.length === 0 ? 0 : 0.5;

  if (subtotalMinor !== null) {
    const drift = Math.abs(itemsSum - subtotalMinor);
    if (drift === 0) confidence += 0.3;
    else if (drift <= Math.max(100, subtotalMinor * 0.02)) confidence += 0.15;
    else warnings.push(
      `Line items add up to ${itemsSum / 100} but the receipt says the subtotal is ${subtotalMinor / 100}. Some lines were probably misread.`,
    );
  }

  if (totalMinor !== null) {
    const expected = itemsSum + taxMinor + tipMinor - discountMinor;
    const drift = Math.abs(expected - totalMinor);
    if (drift === 0) confidence += 0.2;
    else if (drift <= Math.max(100, totalMinor * 0.02)) confidence += 0.1;
    else warnings.push(
      `Items plus tax and tip come to ${expected / 100}, but the printed total is ${totalMinor / 100}. Check the lines before saving.`,
    );
  } else {
    warnings.push('No total found on the receipt - enter it by hand.');
  }

  if (items.length === 0) {
    warnings.push('No line items could be read. Try a flatter, better-lit photo.');
  }

  return {
    items,
    subtotalMinor,
    taxMinor,
    tipMinor,
    discountMinor,
    totalMinor,
    merchant,
    date,
    confidence: Math.min(1, Math.round(confidence * 100) / 100),
    warnings,
  };
}

/**
 * The gap between the lines we read and the total the receipt prints. Shown in
 * the UI as an explicit "unaccounted" row rather than being silently spread
 * across the items - the user is better at spotting a missed dish than we are.
 */
export function unaccounted(parsed: ParsedReceipt): Minor {
  if (parsed.totalMinor === null) return 0;
  const itemsSum = parsed.items.reduce((a, i) => a + i.amountMinor, 0);
  return parsed.totalMinor - (itemsSum + parsed.taxMinor + parsed.tipMinor - parsed.discountMinor);
}
