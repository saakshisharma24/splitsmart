'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const EMOJI = ['\u{1F4B8}', '\u{1F3E0}', '\u{2708}\u{FE0F}', '\u{1F37D}\u{FE0F}', '\u{1F389}', '\u{1F3D6}\u{FE0F}', '\u{1F698}', '\u{1F3AC}'];
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'JPY'];

export function NewGroupForm() {
  const router = useRouter();
  const [emoji, setEmoji] = useState(EMOJI[0]);
  const [emails, setEmails] = useState<string[]>(['']);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    const form = new FormData(e.currentTarget);
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        description: form.get('description') || undefined,
        currency: form.get('currency'),
        emoji,
        memberEmails: emails.map((s) => s.trim()).filter(Boolean),
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? 'Could not create the group');
      setPending(false);
      return;
    }

    // Unknown emails are surfaced rather than silently dropped.
    if (body.unknownEmails?.length) {
      setNotice(
        `Group created. ${body.unknownEmails.join(', ')} ${
          body.unknownEmails.length === 1 ? 'is not' : 'are not'
        } signed up yet - add them once they are.`,
      );
      setTimeout(() => router.push(`/groups/${body.group.id}`), 2600);
      return;
    }
    router.push(`/groups/${body.group.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-5">
      <div>
        <span className="label">Icon</span>
        <div className="flex flex-wrap gap-2">
          {EMOJI.map((e) => (
            <button
              type="button"
              key={e}
              onClick={() => setEmoji(e)}
              aria-pressed={emoji === e}
              className="grid h-11 w-11 place-items-center rounded-xl border text-xl transition"
              style={{
                borderColor: emoji === e ? 'var(--accent)' : 'var(--border)',
                background: emoji === e ? 'var(--accent-soft)' : 'transparent',
              }}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="name">Group name</label>
        <input id="name" name="name" className="input" required maxLength={60} placeholder="Flat 302" />
      </div>

      <div>
        <label className="label" htmlFor="description">Description <span className="normal-case opacity-70">(optional)</span></label>
        <input id="description" name="description" className="input" maxLength={200} placeholder="Rent, bills and the weekly grocery run" />
      </div>

      <div>
        <label className="label" htmlFor="currency">Currency</label>
        <select id="currency" name="currency" className="input" defaultValue="INR">
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          Every amount in this group is recorded in this currency. It cannot be changed later.
        </p>
      </div>

      <div>
        <span className="label">Add members by email</span>
        <div className="space-y-2">
          {emails.map((value, i) => (
            <div key={i} className="flex gap-2">
              <input
                className="input"
                type="email"
                value={value}
                placeholder="friend@example.com"
                onChange={(e) => {
                  const next = [...emails];
                  next[i] = e.target.value;
                  setEmails(next);
                }}
              />
              {emails.length > 1 && (
                <button
                  type="button"
                  className="btn-ghost px-3"
                  aria-label="Remove"
                  onClick={() => setEmails(emails.filter((_, j) => j !== i))}
                >
                  &times;
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" className="mt-2 text-sm font-semibold" style={{ color: 'var(--accent)' }} onClick={() => setEmails([...emails, ''])}>
          + Add another
        </button>
        <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          They need a SplitSmart account already. You will be told about any that are not found.
        </p>
      </div>

      {error && (
        <p className="rounded-xl px-3 py-2.5 text-sm font-medium" role="alert"
           style={{ background: 'color-mix(in srgb, var(--negative) 12%, transparent)', color: 'var(--negative)' }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl px-3 py-2.5 text-sm font-medium"
           style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
          {notice}
        </p>
      )}

      <button className="btn-primary w-full" disabled={pending}>
        {pending ? 'Creating...' : 'Create group'}
      </button>
    </form>
  );
}
