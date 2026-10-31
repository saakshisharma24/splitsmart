'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar, Badge, Money } from './ui';
import { formatMinor, type Minor } from '@/lib/money';
import type { Transfer } from '@/lib/split/types';

interface Member { id: string; name: string; avatarColor: string; upiId: string | null }

/**
 * The settle-up plan, and the clearest demonstration of why this app exists:
 * it says "3 payments instead of 9" out loud.
 */
export function SettleUpCard({
  groupId, currency, transfers, members, viewerId, savings,
}: {
  groupId: string;
  currency: string;
  transfers: Transfer[];
  members: Member[];
  viewerId: string;
  savings: { before: number; after: number; saved: number };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byId = new Map(members.map((m) => [m.id, m]));
  const who = (id: string) => byId.get(id);

  async function markPaid(t: Transfer) {
    const key = `${t.from}-${t.to}-${t.amountMinor}`;
    setBusy(key);
    setError(null);

    const res = await fetch(`/api/groups/${groupId}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromUserId: t.from,
        toUserId: t.to,
        amountMinor: t.amountMinor,
        method: 'UPI',
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Could not record that payment');
      setBusy(null);
      return;
    }
    router.refresh();
    setBusy(null);
  }

  if (transfers.length === 0) {
    return (
      <div className="card">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden>&#9989;</span>
          <div>
            <p className="font-semibold">Everyone is settled up</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No payments outstanding in this group.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Settle up</h2>
        {savings.saved > 0 && (
          <Badge tone="accent">
            {savings.after} payment{savings.after === 1 ? '' : 's'} instead of {savings.before}
          </Badge>
        )}
      </div>

      <ul className="space-y-2">
        {transfers.map((t) => {
          const from = who(t.from);
          const to = who(t.to);
          const key = `${t.from}-${t.to}-${t.amountMinor}`;
          const involvesYou = t.from === viewerId || t.to === viewerId;
          // A UPI deep link only makes sense when YOU are the one paying and
          // the payee has actually set a UPI id.
          const upiLink =
            t.from === viewerId && to?.upiId
              ? `upi://pay?pa=${encodeURIComponent(to.upiId)}&pn=${encodeURIComponent(to.name)}` +
                `&am=${formatMinor(t.amountMinor, currency)}&cu=${currency}` +
                `&tn=${encodeURIComponent('SplitSmart settle up')}`
              : null;

          return (
            <li
              key={key}
              className="flex flex-wrap items-center gap-3 rounded-xl border p-3"
              style={{
                borderColor: involvesYou ? 'var(--accent)' : 'var(--border)',
                background: involvesYou ? 'var(--accent-soft)' : 'transparent',
              }}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Avatar name={from?.name ?? '?'} color={from?.avatarColor ?? '#888'} size={30} />
                <span className="truncate text-sm font-medium">
                  {t.from === viewerId ? 'You' : from?.name}
                </span>
                <span aria-hidden style={{ color: 'var(--text-muted)' }}>&rarr;</span>
                <Avatar name={to?.name ?? '?'} color={to?.avatarColor ?? '#888'} size={30} />
                <span className="truncate text-sm font-medium">
                  {t.to === viewerId ? 'You' : to?.name}
                </span>
              </div>

              <Money minor={t.amountMinor} currency={currency} className="font-bold" />

              <div className="flex gap-2">
                {upiLink && (
                  <a href={upiLink} className="btn-ghost px-3 py-2 text-xs">Pay via UPI</a>
                )}
                <button
                  className="btn-primary px-3 py-2 text-xs"
                  onClick={() => markPaid(t)}
                  disabled={busy === key}
                >
                  {busy === key ? 'Saving...' : 'Mark paid'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="mt-3 text-sm font-medium" style={{ color: 'var(--negative)' }} role="alert">{error}</p>
      )}

      <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        Payments are simplified across the whole group, so you may be asked to pay
        someone you never shared a bill with directly.
      </p>
    </div>
  );
}

export function BalanceList({
  members, net, currency, viewerId,
}: { members: Member[]; net: Record<string, Minor>; currency: string; viewerId: string }) {
  const sorted = [...members].sort((a, b) => (net[b.id] ?? 0) - (net[a.id] ?? 0));
  return (
    <ul className="space-y-1">
      {sorted.map((m) => {
        const value = net[m.id] ?? 0;
        return (
          <li key={m.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
            <Avatar name={m.name} color={m.avatarColor} size={32} />
            <span className="flex-1 truncate text-sm font-medium">
              {m.id === viewerId ? 'You' : m.name}
            </span>
            <span className="text-right">
              <Money minor={value} currency={currency} signed className="text-sm font-semibold" />
              <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                {value > 0 ? 'is owed' : value < 0 ? 'owes' : 'settled'}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
