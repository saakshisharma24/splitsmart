'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Avatar, Badge, EmptyState, Money } from './ui';
import { CATEGORIES, categoryMeta } from '@/lib/analytics/summarize';
import { parseMoney, type Minor } from '@/lib/money';
import { allocate } from '@/lib/split/allocate';
import { describeRule, nextOccurrence, type Frequency } from '@/lib/recurring/schedule';

interface Member { id: string; name: string; avatarColor: string }

export interface RuleRow {
  id: string;
  description: string;
  totalMinor: number;
  category: string;
  frequency: string;
  interval: number;
  startDate: string;
  nextRunAt: string;
  endDate: string | null;
  active: boolean;
}

const FREQUENCIES: Array<{ id: Frequency; label: string }> = [
  { id: 'DAILY', label: 'Daily' },
  { id: 'WEEKLY', label: 'Weekly' },
  { id: 'MONTHLY', label: 'Monthly' },
  { id: 'YEARLY', label: 'Yearly' },
];

export function RecurringManager({
  groupId, currency, members, viewerId, rules,
}: {
  groupId: string;
  currency: string;
  members: Member[];
  viewerId: string;
  rules: RuleRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(rules.length === 0);
  const [description, setDescription] = useState('');
  const [amountText, setAmountText] = useState('');
  const [category, setCategory] = useState('RENT');
  const [frequency, setFrequency] = useState<Frequency>('MONTHLY');
  const [interval, setInterval] = useState('1');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payerId, setPayerId] = useState(viewerId);
  const [selected, setSelected] = useState<string[]>(members.map((m) => m.id));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalMinor = useMemo(() => {
    if (!amountText.trim()) return null;
    try { return parseMoney(amountText, currency); } catch { return null; }
  }, [amountText, currency]);

  const preview = useMemo(() => {
    if (totalMinor === null || totalMinor <= 0 || selected.length === 0) return null;
    try {
      return allocate(totalMinor, { mode: 'EQUAL', participants: selected });
    } catch {
      return null;
    }
  }, [totalMinor, selected]);

  // Show the user the next two firings before they commit - month-end rules in
  // particular behave in a way worth seeing up front.
  const upcoming = useMemo(() => {
    const n = Math.max(1, Number(interval) || 1);
    const rule = { frequency, interval: n, startDate: new Date(`${startDate}T12:00:00`) };
    const first = nextOccurrence(rule, new Date(new Date(`${startDate}T12:00:00`).getTime() - 86_400_000));
    const second = first ? nextOccurrence(rule, first) : null;
    return [first, second].filter(Boolean) as Date[];
  }, [frequency, interval, startDate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (totalMinor === null || !preview) return;
    setPending(true);
    setError(null);

    const res = await fetch(`/api/groups/${groupId}/recurring`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description,
        totalMinor,
        category,
        frequency,
        interval: Math.max(1, Number(interval) || 1),
        startDate: new Date(`${startDate}T12:00:00`).toISOString(),
        payments: { [payerId]: totalMinor },
        split: { mode: 'EQUAL', participants: selected },
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? 'Could not save that rule');
      setPending(false);
      return;
    }
    setDescription('');
    setAmountText('');
    setOpen(false);
    setPending(false);
    router.refresh();
  }

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Active rules</h2>
          <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Cancel' : '+ New rule'}
          </button>
        </div>

        {rules.length === 0 ? (
          <EmptyState emoji="&#128260;" title="No recurring expenses">
            Rent, the shared Netflix account, the cleaner. Set it once and the expense
            appears on its own - dated to the day it was due, even if nobody opened
            the app that month.
          </EmptyState>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {rules.map((r) => {
              const meta = categoryMeta(r.category);
              return (
                <li key={r.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg"
                        style={{ background: `color-mix(in srgb, ${meta.color} 16%, transparent)` }} aria-hidden>
                    {meta.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.description}</span>
                    <span className="block truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                      {describeRule({
                        frequency: r.frequency as Frequency,
                        interval: r.interval,
                        startDate: new Date(r.startDate),
                      })}
                      {r.active
                        ? ` · next ${new Date(r.nextRunAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
                        : ''}
                    </span>
                  </span>
                  <span className="text-right">
                    <Money minor={r.totalMinor} currency={currency} className="block font-semibold" />
                    {!r.active && <Badge>Ended</Badge>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="card space-y-4">
          <h2 className="font-semibold">New recurring expense</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="rdesc">Description</label>
              <input id="rdesc" className="input" required maxLength={140} value={description}
                     onChange={(e) => setDescription(e.target.value)} placeholder="Monthly rent" />
            </div>
            <div>
              <label className="label" htmlFor="ramount">Amount</label>
              <input id="ramount" className="input tabular" inputMode="decimal" value={amountText}
                     onChange={(e) => setAmountText(e.target.value)} placeholder="0.00" />
            </div>
          </div>

          <div>
            <span className="label">Category</span>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => {
                const meta = categoryMeta(c);
                const on = category === c;
                return (
                  <button type="button" key={c} onClick={() => setCategory(c)} aria-pressed={on}
                          className="rounded-full border px-3 py-1.5 text-xs font-medium transition"
                          style={{
                            borderColor: on ? meta.color : 'var(--border)',
                            background: on ? `color-mix(in srgb, ${meta.color} 16%, transparent)` : 'transparent',
                            color: on ? meta.color : 'var(--text-muted)',
                          }}>
                    {meta.emoji} {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="rfreq">Repeats</label>
              <select id="rfreq" className="input" value={frequency}
                      onChange={(e) => setFrequency(e.target.value as Frequency)}>
                {FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="rint">Every</label>
              <input id="rint" className="input tabular" type="number" min={1} max={52}
                     value={interval} onChange={(e) => setInterval(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="rstart">Starting</label>
              <input id="rstart" className="input" type="date" value={startDate}
                     onChange={(e) => setStartDate(e.target.value)} />
            </div>
          </div>

          {upcoming.length > 0 && (
            <p className="rounded-xl px-3 py-2.5 text-xs" style={{ background: 'var(--bg-sunken)', color: 'var(--text-muted)' }}>
              Next two: {upcoming.map((d) =>
                d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })).join(', ')}
            </p>
          )}

          <div>
            <label className="label" htmlFor="rpayer">Paid by</label>
            <select id="rpayer" className="input" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.id === viewerId ? `${m.name} (you)` : m.name}</option>
              ))}
            </select>
          </div>

          <div>
            <span className="label">Split equally between</span>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const on = selected.includes(m.id);
                return (
                  <button type="button" key={m.id} onClick={() => toggle(m.id)} aria-pressed={on}
                          className="flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm font-medium transition"
                          style={{
                            borderColor: on ? 'var(--accent)' : 'var(--border)',
                            background: on ? 'var(--accent-soft)' : 'transparent',
                            opacity: on ? 1 : 0.55,
                          }}>
                    <Avatar name={m.name} color={m.avatarColor} size={24} />
                    {m.id === viewerId ? 'You' : m.name.split(' ')[0]}
                  </button>
                );
              })}
            </div>
            {preview && (
              <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                Each cycle: <Money minor={preview[selected[0]]} currency={currency} /> each
                {selected.length > 1 ? ` across ${selected.length} people` : ''}.
              </p>
            )}
          </div>

          {error && (
            <p className="rounded-xl px-3 py-2.5 text-sm font-medium" role="alert"
               style={{ background: 'color-mix(in srgb, var(--negative) 12%, transparent)', color: 'var(--negative)' }}>
              {error}
            </p>
          )}

          <button className="btn-primary w-full"
                  disabled={pending || totalMinor === null || !preview || !description.trim()}>
            {pending ? 'Saving...' : 'Create rule'}
          </button>
          <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
            If the start date is today or earlier, the first expense is created straight away.
          </p>
        </form>
      )}
    </div>
  );
}
