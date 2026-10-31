import 'server-only';

import { parseMoney } from '../money';
import { parseReceiptText, type ParsedReceipt } from './parse';

/**
 * Optional second pass: hand the receipt photo to Claude and let it read the
 * bill directly.
 *
 * Entirely optional. Without ANTHROPIC_API_KEY the app still scans receipts -
 * Tesseract plus the rule-based parser in ./parse.ts handles a clean printed
 * bill fine. Where this earns its keep is the messy half of real life: a
 * crumpled thermal receipt, a handwritten total, two columns, Hindi item names
 * next to English ones. Heuristics fall over there; a vision model does not.
 *
 * Runs server-side only, so the API key never reaches the browser.
 */

const MODEL = 'claude-opus-5';

const SYSTEM = `You read photographs of receipts and bills and return structured data.

Return ONLY a JSON object, no prose and no markdown fence, shaped exactly like:
{
  "merchant": string | null,
  "date": string | null,          // as printed, e.g. "14/03/2026"
  "currency": string,             // ISO 4217, e.g. "INR". Infer from the symbol.
  "items": [{ "label": string, "amount": string, "quantity": number }],
  "subtotal": string | null,
  "tax": string | null,           // all tax lines added together (GST, CGST+SGST, VAT)
  "tip": string | null,           // service charge or gratuity
  "discount": string | null,      // as a positive number
  "total": string | null
}

Rules:
- Amounts are decimal strings exactly as printed: "1234.50", not 1234.5 and not "Rs 1234.50".
- "items" is only things that were bought. Never include subtotal, tax, service
  charge, discount, total, payment-method lines, the shop's address, GSTIN, or
  phone number.
- "quantity" is how many of that line were ordered; use 1 when not printed.
- The line amount is the total for that line, not the unit price.
- If a value is genuinely not on the receipt, use null. Do not guess or compute it.`;

export interface EnhanceResult extends ParsedReceipt {
  source: 'claude' | 'local';
}

/**
 * @param imageBase64 the receipt image, base64 with no data: prefix
 * @param mediaType   image/jpeg, image/png, image/webp or image/gif
 * @param fallbackText OCR text from Tesseract, used if the API call fails
 */
export async function enhanceReceipt(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  fallbackText = '',
  currency = 'INR',
): Promise<EnhanceResult> {
  const localFallback = (): EnhanceResult => ({
    ...parseReceiptText(fallbackText, currency),
    source: 'local',
  });

  if (!process.env.ANTHROPIC_API_KEY) return localFallback();

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: 'Read this receipt and return the JSON described in the system prompt.' },
          ],
        },
      ],
    });

    // Claude can decline; check before reading content.
    if (response.stop_reason === 'refusal') return localFallback();

    const text = response.content
      .filter((b): b is { type: 'text'; text: string } & typeof b => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    const parsed = coerce(text, currency);
    return parsed ?? localFallback();
  } catch {
    // A missing key, a rate limit, a network blip - none of these should stop
    // somebody splitting a bill. Fall back to the local parse silently.
    return localFallback();
  }
}

/** Shape-check and convert Claude's JSON into the same ParsedReceipt the local parser returns. */
function coerce(text: string, currency: string): EnhanceResult | null {
  // Strip a markdown fence if one slipped through.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;

  const cur = typeof o.currency === 'string' && o.currency.length === 3 ? o.currency : currency;
  const money = (v: unknown): number | null => {
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    try {
      return parseMoney(v, cur);
    } catch {
      return null;
    }
  };

  const items = Array.isArray(o.items)
    ? o.items.flatMap((it) => {
        if (typeof it !== 'object' || it === null) return [];
        const i = it as Record<string, unknown>;
        const amountMinor = money(i.amount);
        if (amountMinor === null || amountMinor <= 0) return [];
        const label = typeof i.label === 'string' ? i.label.trim() : '';
        if (!label) return [];
        const q = typeof i.quantity === 'number' ? Math.round(i.quantity) : 1;
        return [{
          label,
          amountMinor,
          quantity: q >= 1 && q <= 999 ? q : 1,
          sourceLine: label,
        }];
      })
    : [];

  const taxMinor = money(o.tax) ?? 0;
  const tipMinor = money(o.tip) ?? 0;
  const discountMinor = Math.abs(money(o.discount) ?? 0);
  const totalMinor = money(o.total);
  const subtotalMinor = money(o.subtotal);

  const warnings: string[] = [];
  const itemsSum = items.reduce((a, i) => a + i.amountMinor, 0);
  let confidence = items.length === 0 ? 0.2 : 0.75;

  // Same reconciliation the local parser does. A vision model is good, not
  // infallible, and the arithmetic check is free.
  if (totalMinor !== null) {
    const drift = Math.abs(itemsSum + taxMinor + tipMinor - discountMinor - totalMinor);
    if (drift === 0) confidence = 0.98;
    else if (drift <= Math.max(100, totalMinor * 0.02)) confidence = 0.85;
    else {
      confidence = 0.5;
      warnings.push(
        `The scanned lines come to ${(itemsSum + taxMinor + tipMinor - discountMinor) / 100} but the receipt total reads ${totalMinor / 100}. Check before saving.`,
      );
    }
  } else {
    warnings.push('No total was found on the receipt - enter it by hand.');
  }
  if (items.length === 0) warnings.push('No line items could be read from this image.');

  return {
    items,
    subtotalMinor,
    taxMinor,
    tipMinor,
    discountMinor,
    totalMinor,
    merchant: typeof o.merchant === 'string' ? o.merchant : null,
    date: typeof o.date === 'string' ? o.date : null,
    confidence,
    warnings,
    source: 'claude',
  };
}
