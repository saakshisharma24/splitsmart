'use client';

import { useRef, useState } from 'react';
import { formatMoney } from '@/lib/money';
import type { ParsedReceipt } from '@/lib/ocr/parse';
import type { ScanProgress } from '@/lib/ocr/scan';

/**
 * Photo -> line items.
 *
 * OCR runs in the browser, so the picture of your dinner never leaves your
 * phone. If the local read does not reconcile against the printed total, and a
 * server key is configured, the user is offered a second pass that sends the
 * image to Claude - opt-in, never automatic, because that one does upload it.
 */
export function ReceiptScanner({
  currency, onApply, onClose,
}: {
  currency: string;
  onApply: (parsed: ParsedReceipt) => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [result, setResult] = useState<ParsedReceipt | null>(null);
  const [rawText, setRawText] = useState('');
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(f: File) {
    setFile(f);
    setResult(null);
    setError(null);
    setPreview(URL.createObjectURL(f));

    // Ask the server whether the AI fallback is even configured, so we do not
    // offer a button that cannot work.
    fetch('/api/receipt/enhance')
      .then((r) => r.json())
      .then((b) => setAiAvailable(Boolean(b.available)))
      .catch(() => setAiAvailable(false));

    try {
      const { prepareImage, scanReceipt } = await import('@/lib/ocr/scan');
      const prepared = await prepareImage(f);
      const scan = await scanReceipt(prepared, currency, setProgress);
      setResult(scan);
      setRawText(scan.rawText);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that image');
    } finally {
      setProgress(null);
    }
  }

  async function retryWithAI() {
    if (!file) return;
    setAiBusy(true);
    setError(null);
    try {
      const base64 = await toBase64(file);
      const mediaType = (['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const)
        .find((t) => t === file.type) ?? 'image/jpeg';

      const res = await fetch('/api/receipt/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mediaType, ocrText: rawText, currency }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'That did not work');
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not re-read that receipt');
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl"
        style={{ background: 'var(--bg-elevated)' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Scan a receipt</h2>
          <button onClick={onClose} className="btn-ghost px-3 py-1.5 text-sm" aria-label="Close">Close</button>
        </div>

        {!file && (
          <>
            <button
              className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-10 transition"
              style={{ borderColor: 'var(--border)' }}
              onClick={() => fileRef.current?.click()}
            >
              <span className="text-4xl" aria-hidden>&#128247;</span>
              <span className="font-semibold">Take a photo or choose one</span>
              <span className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                Reading happens on your device. The photo is not uploaded.
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </>
        )}

        {preview && (
          <div className="mb-4 overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="The receipt being scanned" className="max-h-48 w-full object-cover" />
          </div>
        )}

        {progress && (
          <div className="mb-4">
            <p className="mb-2 text-sm font-medium">{progress.message}</p>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg-sunken)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.round(progress.progress * 100)}%`, background: 'var(--accent)' }}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="mb-4 rounded-xl px-3 py-2.5 text-sm font-medium" role="alert"
             style={{ background: 'color-mix(in srgb, var(--negative) 12%, transparent)', color: 'var(--negative)' }}>
            {error}
          </p>
        )}

        {result && (
          <>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">
                {result.items.length} item{result.items.length === 1 ? '' : 's'} found
                {result.merchant ? ` at ${result.merchant}` : ''}
              </p>
              <ConfidenceBadge value={result.confidence} />
            </div>

            {result.warnings.length > 0 && (
              <ul className="mb-3 space-y-1.5">
                {result.warnings.map((w, i) => (
                  <li key={i} className="rounded-xl px-3 py-2 text-xs"
                      style={{ background: 'color-mix(in srgb, #eab308 14%, transparent)', color: '#a16207' }}>
                    {w}
                  </li>
                ))}
              </ul>
            )}

            <ul className="mb-3 space-y-1">
              {result.items.map((it, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {it.quantity > 1 && (
                      <span className="mr-1 font-semibold" style={{ color: 'var(--text-muted)' }}>
                        {it.quantity}&times;
                      </span>
                    )}
                    {it.label}
                  </span>
                  <span className="tabular">{formatMoney(it.amountMinor, currency)}</span>
                </li>
              ))}
            </ul>

            <dl className="mb-4 space-y-1 border-t pt-2 text-sm" style={{ borderColor: 'var(--border)' }}>
              {result.taxMinor > 0 && <Row label="Tax" value={formatMoney(result.taxMinor, currency)} />}
              {result.tipMinor > 0 && <Row label="Service charge" value={formatMoney(result.tipMinor, currency)} />}
              {result.discountMinor > 0 && <Row label="Discount" value={`-${formatMoney(result.discountMinor, currency)}`} />}
              {result.totalMinor !== null && (
                <Row label="Total" value={formatMoney(result.totalMinor, currency)} bold />
              )}
            </dl>

            <div className="flex flex-wrap gap-2">
              <button className="btn-primary flex-1" onClick={() => onApply(result)} disabled={result.items.length === 0}>
                Use these items
              </button>
              {aiAvailable && (
                <button className="btn-ghost" onClick={retryWithAI} disabled={aiBusy}>
                  {aiBusy ? 'Re-reading...' : 'Re-read with AI'}
                </button>
              )}
            </div>
            {aiAvailable && (
              <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                Re-reading sends the photo to Claude. Everything else stays on your device.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}>
      <dt style={bold ? undefined : { color: 'var(--text-muted)' }}>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const tone = value >= 0.85 ? 'var(--positive)' : value >= 0.6 ? '#eab308' : 'var(--negative)';
  const label = value >= 0.85 ? 'Looks right' : value >= 0.6 ? 'Check it' : 'Low confidence';
  return (
    <span className="rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{ background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone }}>
      {label}
    </span>
  );
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      // Strip the "data:image/jpeg;base64," prefix - the API wants raw base64.
      resolve(s.slice(s.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}
