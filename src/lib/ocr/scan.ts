'use client';

import { parseReceiptText, type ParsedReceipt } from './parse';

/**
 * Runs OCR in the browser via Tesseract's WASM build.
 *
 * Client-side on purpose: the receipt photo never leaves the device, there is
 * no upload round-trip, and the app costs nothing to run. The tradeoff is a
 * ~2MB worker download on first use, which is why the module is imported
 * lazily - someone who never scans a receipt never pays for it.
 */

export interface ScanProgress {
  stage: 'loading' | 'recognizing' | 'parsing' | 'done';
  /** 0-1 within the current stage. */
  progress: number;
  message: string;
}

export interface ScanResult extends ParsedReceipt {
  rawText: string;
}

export async function scanReceipt(
  file: File | Blob,
  currency = 'INR',
  onProgress?: (p: ScanProgress) => void,
): Promise<ScanResult> {
  const report = (stage: ScanProgress['stage'], progress: number, message: string) =>
    onProgress?.({ stage, progress, message });

  report('loading', 0, 'Loading the text recogniser...');

  // Dynamic import so the WASM bundle stays out of the initial page load.
  const { createWorker } = await import('tesseract.js');

  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') {
        report('recognizing', m.progress, 'Reading the receipt...');
      }
    },
  });

  try {
    // Receipts are a single column of text; telling Tesseract that measurably
    // improves line segmentation over the default page-layout analysis.
    await worker.setParameters({
      // @ts-expect-error - tesseract.js types lag the string enum it accepts.
      tessedit_pageseg_mode: '4', // PSM 4: a single column of variable-size text
      preserve_interword_spaces: '1',
    });

    const { data } = await worker.recognize(file);
    report('parsing', 0.9, 'Pulling out the line items...');

    const parsed = parseReceiptText(data.text, currency);
    report('done', 1, 'Done');

    return { ...parsed, rawText: data.text };
  } finally {
    // Always tear the worker down - a leaked one holds megabytes of WASM heap.
    await worker.terminate();
  }
}

/**
 * Downscale before OCR. Phone photos are 12MP; Tesseract neither needs nor
 * benefits from that, and the resize cuts recognition time by roughly 4x.
 */
export async function prepareImage(file: File, maxDimension = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  if (scale === 1) return file;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', 0.9);
  });
}
