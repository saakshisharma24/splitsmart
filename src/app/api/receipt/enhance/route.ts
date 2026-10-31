import { NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { enhanceReceipt } from '@/lib/ocr/enhance';
import { rateLimit, tooManyRequests } from '@/lib/rate-limit';

const schema = z.object({
  // Base64 with no data: prefix. Capped so a huge upload cannot be used to
  // burn API credits or memory.
  imageBase64: z.string().min(32).max(8_000_000),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ocrText: z.string().max(100_000).default(''),
  currency: z.string().length(3).default('INR'),
});

/**
 * Optional server-side second pass over a receipt photo.
 *
 * The client scans locally first and only calls this when the local parse came
 * back shaky. If no API key is configured, enhanceReceipt returns the local
 * parse and the response says so via `source`.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();

    // Keyed on the account, not the IP: every call here spends API credit, and
    // the caller is authenticated so there is a better key available than a
    // header they control.
    const limit = rateLimit(`enhance:${user.id}`, 20, 60 * 60_000);
    if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

    const input = schema.parse(await readJson(request));

    const result = await enhanceReceipt(
      input.imageBase64,
      input.mediaType,
      input.ocrText,
      input.currency,
    );
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

/** Lets the client decide whether offering "scan again with AI" makes sense. */
export async function GET() {
  return NextResponse.json({ available: Boolean(process.env.ANTHROPIC_API_KEY) });
}
