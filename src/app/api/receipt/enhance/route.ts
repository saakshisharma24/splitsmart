import { NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { enhanceReceipt } from '@/lib/ocr/enhance';

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
    await requireUser();
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
