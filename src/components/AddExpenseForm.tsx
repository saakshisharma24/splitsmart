'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Avatar, Money } from './ui';
import { ReceiptScanner } from './ReceiptScanner';
import { CATEGORIES, categoryMeta } from '@/lib/analytics/summarize';
import { formatMinor, parseMoney, type Minor } from '@/lib/money';
import { allocate } from '@/lib/split/allocate';
import type { LineItem, SplitMode, SplitSpec } from '@/lib/split/types';
import type { ParsedReceipt } from '@/lib/ocr/parse';

interface Member { id: string; name: string; avatarColor: string }

const MODES: Array<{ id: SplitMode; label: string; hint: string }> = [
  { id: 'EQUAL',    label: 'Equally',   hint: 'Everyone selected pays the same' },
  { id: 'EXACT',    label: 'Amounts',   hint: 'Type what each person owes' },
  { id: 'PERCENT',  label: 'Percent',   hint: 'Split by percentage' },
  { id: 'SHARES',   label: 'Shares',    hint: 'Weights, e.g. 2 : 1 : 1' },
  { id: 'ITEMIZED', label: 'By item',   hint: 'Per dish, with tax spread fairly' },
];

export function AddExpenseForm({
  groupId, currency, members, viewerId,
}: { groupId: string; currency: string; members: Member[]; viewerId: string }) {
  const router = useRouter();

  const [description, setDescription] = useState('');
  const [amountText, setAmountText] = useState('');
  const [category, setCategory] = useState<string>('FOOD');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payerId, setPayerId] = useState(viewerId);
  const [mode, setMode] = useState<SplitMode>('EQUAL');
  const [scanning, setScanning] = useState(false);
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string[]>(members.map((m) => m.id));
  const [exact, setExact] = useState<Record<string, string>>({});
  const [percent, setPercent] = useState<Record<string, string>>({});
  const [shares, setShares] = useState<Record<string, string>>(
    Object.fromEntries(members.map((m) => [m.id, '1'])),
  );
  const [items, setItems] = useState<LineItem[]>([]);
  const [taxText, setTaxText] = useState('');
  const [tipText, setTipText] = useState('');
  const [discountText, setDiscountText] = useState('');

  const totalMinor = safeParse(amountText, currency);
  const taxMinor = safeParse(taxText, currency) ?? 0;
  const tipMinor = safeParse(tipText, currency) ?? 0;
  const discountMinor = safeParse(discountText, currency) ?? 0;

  // Itemized derives its own total from the lines - typing it twice is a bug
  // waiting to happen, so the amount field becomes read-only in that mode.
  const itemsTotal = items.reduce((a, i) => a + i.amountMinor, 0);
  const effectiveTotal = mode === 'ITEMIZED'
    ? itemsTotal + taxMinor + tipMinor - discountMinor
    : totalMinor;

  const spec: SplitSpec | null = useMemo(() => {
    switch (mode) {
      case 'EQUAL':
        return selected.length ? { mode: 'EQUAL', participants: selected } : null;
      case 'EXACT':
        return {
          mode: 'EXACT',
          amounts: Object.fromEntries(
            selected.map((id) => [id, safeParse(exact[id] ?? '', currency) ?? 0]),
          ),
        };
      case 'PERCENT':
        return {
          mode: 'PERCENT',
          basisPoints: Object.fromEntries(
            selected.map((id) => [id, Math.round((Number(percent[id] ?? 0) || 0) * 100)]),
          ),
        };
      case 'SHARES':
        return {
          mode: 'SHARES',
          shares: Object.fromEntries(
            selected.map((id) => [id, Number(shares[id] ?? 0) || 0]),
          ),
        };
      case 'ITEMIZED':
        return items.length
          ? { mode: 'ITEMIZED', participants: selected, items, taxMinor, tipMinor, discountMinor }
          : null;
      default:
        return null;
    }
  }, [mode, selected, exact, percent, shares, items, taxMinor, tipMinor, discountMinor, currency]);

  // Live preview. The exact same engine the server uses runs here, so what the
  // user sees before saving is what gets stored - not an approximation.
  const { allocation, splitError } = useMemo(() => {
    if (!spec || effectiveTotal === null || effectiveTotal <= 0) {
      return { allocation: null, splitError: null };
    }
    try {
      return { allocation: allocate(effectiveTotal, spec), splitError: null };
    } catch (err) {
      return { allocation: null, splitError: err instanceof Error ? err.message : 'That split does not add up' };
    }
  }, [spec, effectiveTotal]);

  function applyReceipt(parsed: ParsedReceipt) {
    setItems(
      parsed.items.map((it, i) => ({
        id: `scan-${i}`,
        label: it.quantity > 1 ? `${it.quantity}x ${it.label}` : it.label,
        amountMinor: it.amountMinor,
        participants: [], // empty = shared by everyone until the user assigns it
      })),
    );
    setTaxText(parsed.taxMinor ? formatMinor(parsed.taxMinor, currency) : '');
    setTipText(parsed.tipMinor ? formatMinor(parsed.tipMinor, currency) : '');
    setDiscountText(parsed.discountMinor ? formatMinor(parsed.discountMinor, currency) : '');
    if (parsed.totalMinor !== null) setAmountText(formatMinor(parsed.totalMinor, currency));
    if (!description && parsed.merchant) setDescription(parsed.merchant);
    setMode('ITEMIZED');
    setScanning(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!spec || effectiveTotal === null || splitError) return;

    setPending(true);
    setServerError(null);

    const res = await fetch(`/api/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description,
        totalMinor: effectiveTotal,
        category,
        date: new Date(`${date}T12:00:00`).toISOString(),
        payments: { [payerId]: effectiveTotal },
        split: spec,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setServerError(body.error ?? 'Could not save that expense');
      setPending(false);
      return;
    }
    router.push(`/groups/${groupId}`);
    router.refresh();
  }

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const canSubmit =
    description.trim().length > 0 &&
    effectiveTotal !== null &&
    effectiveTotal > 0 &&
    !splitError &&
    allocation !== null &&
    !pending;

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="card space-y-4">
          <div>
            <label className="label" htmlFor="description">What was it for?</label>
            <input
              id="description" className="input" value={description} required maxLength={140}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Dinner at Toit"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="amount">Total amount</label>
              <input
                id="amount" className="input tabular" inputMode="decimal"
                value={mode === 'ITEMIZED' && items.length > 0 ? formatMinor(effectiveTotal ?? 0, currency) : amountText}
                readOnly={mode === 'ITEMIZED' && items.length > 0}
                onChange={(e) => setAmountText(e.target.value)}
                placeholder="0.00"
              />
              {mode === 'ITEMIZED' && items.length > 0 && (
                <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                  Added up from the items below.
                </p>
              )}
              {amountText && totalMinor === null && mode !== 'ITEMIZED' && (
                <p className="mt-1.5 text-xs" style={{ color: 'var(--negative)' }}>
                  That is not an amount I can read.
                </p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="date">Date</label>
              <input id="date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div>
            <span className="label">Category</span>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => {
                const meta = categoryMeta(c);
                const on = category === c;
                return (
                  <button
                    type="button" key={c} onClick={() => setCategory(c)} aria-pressed={on}
                    className="rounded-full border px-3 py-1.5 text-xs font-medium transition"
                    style={{
                      borderColor: on ? meta.color : 'var(--border)',
                      background: on ? `color-mix(in srgb, ${meta.color} 16%, transparent)` : 'transparent',
                      color: on ? meta.color : 'var(--text-muted)',
                    }}
                  >
                    {meta.emoji} {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="payer">Paid by</label>
            <select id="payer" className="input" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.id === viewerId ? `${m.name} (you)` : m.name}</option>
              ))}
            </select>
          </div>

          <button type="button" className="btn-ghost w-full" onClick={() => setScanning(true)}>
            &#128247; Scan a receipt instead
          </button>
        </div>

        <div className="card space-y-4">
          <div>
            <span className="label">How should it be split?</span>
            <div className="flex flex-wrap gap-1.5">
              {MODES.map((m) => (
                <button
                  type="button" key={m.id} onClick={() => setMode(m.id)} aria-pressed={mode === m.id}
                  title={m.hint}
                  className="rounded-xl border px-3 py-2 text-xs font-semibold transition"
                  style={{
                    borderColor: mode === m.id ? 'var(--accent)' : 'var(--border)',
                    background: mode === m.id ? 'var(--accent-soft)' : 'transparent',
                    color: mode === m.id ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              {MODES.find((m) => m.id === mode)?.hint}
            </p>
          </div>

          <div>
            <span className="label">Who is involved?</span>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const on = selected.includes(m.id);
                return (
                  <button
                    type="button" key={m.id} onClick={() => toggle(m.id)} aria-pressed={on}
                    className="flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm font-medium transition"
                    style={{
                      borderColor: on ? 'var(--accent)' : 'var(--border)',
                      background: on ? 'var(--accent-soft)' : 'transparent',
                      opacity: on ? 1 : 0.55,
                    }}
                  >
                    <Avatar name={m.name} color={m.avatarColor} size={24} />
                    {m.id === viewerId ? 'You' : m.name.split(' ')[0]}
                  </button>
                );
              })}
            </div>
          </div>

          {mode === 'EXACT' && (
            <PerPersonInputs
              members={members.filter((m) => selected.includes(m.id))}
              values={exact} onChange={setExact} suffix={currency} placeholder="0.00" viewerId={viewerId}
            />
          )}
          {mode === 'PERCENT' && (
            <PerPersonInputs
              members={members.filter((m) => selected.includes(m.id))}
              values={percent} onChange={setPercent} suffix="%" placeholder="0" viewerId={viewerId}
            />
          )}
          {mode === 'SHARES' && (
            <PerPersonInputs
              members={members.filter((m) => selected.includes(m.id))}
              values={shares} onChange={setShares} suffix="shares" placeholder="1" viewerId={viewerId}
            />
          )}

          {mode === 'ITEMIZED' && (
            <ItemEditor
              items={items} setItems={setItems}
              members={members.filter((m) => selected.includes(m.id))}
              currency={currency} viewerId={viewerId}
              taxText={taxText} setTaxText={setTaxText}
              tipText={tipText} setTipText={setTipText}
              discountText={discountText} setDiscountText={setDiscountText}
            />
          )}
        </div>

        <div className="card">
          <h2 className="mb-3 font-semibold">Everyone owes</h2>
          {splitError ? (
            <p className="rounded-xl px-3 py-2.5 text-sm font-medium"
               style={{ background: 'color-mix(in srgb, var(--negative) 12%, transparent)', color: 'var(--negative)' }}>
              {splitError}
            </p>
          ) : allocation ? (
            <ul className="space-y-1.5">
              {members.filter((m) => allocation[m.id] !== undefined).map((m) => (
                <li key={m.id} className="flex items-center gap-2.5 text-sm">
                  <Avatar name={m.name} color={m.avatarColor} size={26} />
                  <span className="flex-1 truncate">{m.id === viewerId ? 'You' : m.name}</span>
                  <Money minor={allocation[m.id]} currency={currency} className="font-semibold" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Enter an amount and pick who is involved.
            </p>
          )}
        </div>

        {serverError && (
          <p className="rounded-xl px-3 py-2.5 text-sm font-medium" role="alert"
             style={{ background: 'color-mix(in srgb, var(--negative) 12%, transparent)', color: 'var(--negative)' }}>
            {serverError}
          </p>
        )}

        <button className="btn-primary w-full" disabled={!canSubmit}>
          {pending ? 'Saving...' : 'Save expense'}
        </button>
      </form>

      {scanning && (
        <ReceiptScanner currency={currency} onApply={applyReceipt} onClose={() => setScanning(false)} />
      )}
    </>
  );
}

function PerPersonInputs({
  members, values, onChange, suffix, placeholder, viewerId,
}: {
  members: Member[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  suffix: string;
  placeholder: string;
  viewerId: string;
}) {
  return (
    <ul className="space-y-2">
      {members.map((m) => (
        <li key={m.id} className="flex items-center gap-2.5">
          <Avatar name={m.name} color={m.avatarColor} size={28} />
          <span className="flex-1 truncate text-sm">{m.id === viewerId ? 'You' : m.name}</span>
          <input
            className="input tabular w-28 text-right"
            inputMode="decimal"
            placeholder={placeholder}
            value={values[m.id] ?? ''}
            onChange={(e) => onChange({ ...values, [m.id]: e.target.value })}
          />
          <span className="w-14 text-xs" style={{ color: 'var(--text-muted)' }}>{suffix}</span>
        </li>
      ))}
    </ul>
  );
}

function ItemEditor({
  items, setItems, members, currency, viewerId,
  taxText, setTaxText, tipText, setTipText, discountText, setDiscountText,
}: {
  items: LineItem[];
  setItems: (i: LineItem[]) => void;
  members: Member[];
  currency: string;
  viewerId: string;
  taxText: string; setTaxText: (v: string) => void;
  tipText: string; setTipText: (v: string) => void;
  discountText: string; setDiscountText: (v: string) => void;
}) {
  function update(i: number, patch: Partial<LineItem>) {
    setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {items.map((it, i) => (
          <li key={it.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
            <div className="mb-2 flex gap-2">
              <input
                className="input flex-1" value={it.label} placeholder="Item"
                onChange={(e) => update(i, { label: e.target.value })}
              />
              <input
                className="input tabular w-28 text-right" inputMode="decimal"
                value={formatMinor(it.amountMinor, currency)}
                onChange={(e) => {
                  const v = safeParse(e.target.value, currency);
                  if (v !== null) update(i, { amountMinor: v });
                }}
              />
              <button
                type="button" className="btn-ghost px-3" aria-label="Remove item"
                onClick={() => setItems(items.filter((_, j) => j !== i))}
              >
                &times;
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => update(i, { participants: [] })}
                className="rounded-full border px-2.5 py-1 text-xs font-medium"
                style={{
                  borderColor: it.participants.length === 0 ? 'var(--accent)' : 'var(--border)',
                  background: it.participants.length === 0 ? 'var(--accent-soft)' : 'transparent',
                  color: it.participants.length === 0 ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                Shared
              </button>
              {members.map((m) => {
                const on = it.participants.includes(m.id);
                return (
                  <button
                    type="button" key={m.id}
                    onClick={() =>
                      update(i, {
                        participants: on
                          ? it.participants.filter((x) => x !== m.id)
                          : [...it.participants, m.id],
                      })
                    }
                    className="rounded-full border px-2.5 py-1 text-xs font-medium"
                    style={{
                      borderColor: on ? 'var(--accent)' : 'var(--border)',
                      background: on ? 'var(--accent-soft)' : 'transparent',
                      color: on ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >
                    {m.id === viewerId ? 'You' : m.name.split(' ')[0]}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button" className="btn-ghost w-full"
        onClick={() =>
          setItems([...items, { id: `item-${Date.now()}`, label: '', amountMinor: 0, participants: [] }])
        }
      >
        + Add an item
      </button>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="tax">Tax / GST</label>
          <input id="tax" className="input tabular" inputMode="decimal" value={taxText}
                 onChange={(e) => setTaxText(e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <label className="label" htmlFor="tip">Service / tip</label>
          <input id="tip" className="input tabular" inputMode="decimal" value={tipText}
                 onChange={(e) => setTipText(e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <label className="label" htmlFor="discount">Discount</label>
          <input id="discount" className="input tabular" inputMode="decimal" value={discountText}
                 onChange={(e) => setDiscountText(e.target.value)} placeholder="0.00" />
        </div>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Tax, service charge and discount are spread in proportion to what each person
        actually ordered - not divided equally.
      </p>
    </div>
  );
}

/** Returns null rather than throwing, so a half-typed amount does not crash the form. */
function safeParse(text: string, currency: string): Minor | null {
  if (!text.trim()) return null;
  try {
    return parseMoney(text, currency);
  } catch {
    return null;
  }
}
