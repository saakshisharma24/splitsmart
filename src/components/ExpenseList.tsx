'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar, Money } from './ui';
import { categoryMeta } from '@/lib/analytics/summarize';
import type { Minor } from '@/lib/money';

interface Member { id: string; name: string; avatarColor: string }

interface ExpenseRow {
  id: string;
  description: string;
  category: string;
  totalMinor: Minor;
  /** ISO string - Dates do not survive the server/client boundary cleanly. */
  date: string;
  payments: Record<string, Minor>;
  shares: Record<string, Minor>;
}

export function ExpenseList({
  groupId, currency, expenses, members, viewerId,
}: {
  groupId: string;
  currency: string;
  expenses: ExpenseRow[];
  members: Member[];
  viewerId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const byId = new Map(members.map((m) => [m.id, m]));

  async function remove(id: string) {
    setDeleting(id);
    const res = await fetch(`/api/groups/${groupId}/expenses/${id}`, { method: 'DELETE' });
    setDeleting(null);
    setConfirming(null);
    if (res.ok) router.refresh();
  }

  return (
    <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
      {expenses.map((e) => {
        const meta = categoryMeta(e.category);
        const yourShare = e.shares[viewerId] ?? 0;
        const youPaid = e.payments[viewerId] ?? 0;
        const payers = Object.entries(e.payments).filter(([, amt]) => amt !== 0);
        const date = new Date(e.date);
        const isOpen = open === e.id;

        return (
          <li key={e.id} className="py-3 first:pt-0 last:pb-0">
            <button
              className="flex w-full items-center gap-3 text-left"
              onClick={() => setOpen(isOpen ? null : e.id)}
              aria-expanded={isOpen}
            >
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg"
                style={{ background: `color-mix(in srgb, ${meta.color} 16%, transparent)` }}
                aria-hidden
              >
                {meta.emoji}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{e.description}</span>
                <span className="block truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                  {date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  {' · '}
                  {payers.length === 1
                    ? `${payers[0][0] === viewerId ? 'You' : byId.get(payers[0][0])?.name ?? '?'} paid`
                    : `${payers.length} people paid`}
                </span>
              </span>

              <span className="text-right">
                <Money minor={e.totalMinor} currency={currency} className="block font-semibold" />
                <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                  {youPaid - yourShare === 0
                    ? 'not involved'
                    : youPaid - yourShare > 0
                      ? 'you lent'
                      : 'your share'}
                  {' '}
                  <Money
                    minor={Math.abs(youPaid - yourShare) || yourShare}
                    currency={currency}
                  />
                </span>
              </span>
            </button>

            {isOpen && (
              <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--bg-sunken)' }}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Breakdown
                </p>
                <ul className="space-y-1.5">
                  {members
                    .filter((m) => (e.shares[m.id] ?? 0) !== 0 || (e.payments[m.id] ?? 0) !== 0)
                    .map((m) => (
                      <li key={m.id} className="flex items-center gap-2 text-sm">
                        <Avatar name={m.name} color={m.avatarColor} size={22} />
                        <span className="flex-1 truncate">{m.id === viewerId ? 'You' : m.name}</span>
                        {(e.payments[m.id] ?? 0) > 0 && (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            paid <Money minor={e.payments[m.id]} currency={currency} />
                          </span>
                        )}
                        <span className="w-24 text-right tabular">
                          <Money minor={e.shares[m.id] ?? 0} currency={currency} />
                        </span>
                      </li>
                    ))}
                </ul>

                <div className="mt-3 flex justify-end">
                  {confirming === e.id ? (
                    <span className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        Delete this expense?
                      </span>
                      <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setConfirming(null)}>
                        Cancel
                      </button>
                      <button
                        className="btn px-3 py-1.5 text-xs text-white"
                        style={{ background: 'var(--negative)' }}
                        onClick={() => remove(e.id)}
                        disabled={deleting === e.id}
                      >
                        {deleting === e.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </span>
                  ) : (
                    <button
                      className="text-xs font-semibold"
                      style={{ color: 'var(--negative)' }}
                      onClick={() => setConfirming(e.id)}
                    >
                      Delete expense
                    </button>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
