'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const isSignup = mode === 'signup';
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const data = Object.fromEntries(new FormData(e.currentTarget));
    const res = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Something went wrong' }));
      setError(body.error ?? 'Something went wrong');
      setPending(false);
      return;
    }
    // Server components cache aggressively; refresh so the dashboard re-renders
    // with the new session rather than the signed-out shell.
    router.push('/');
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <div className="mb-8 text-center">
        <p className="text-4xl">&#128184;</p>
        <h1 className="mt-3 text-2xl font-bold">
          {isSignup ? 'Create your account' : 'Welcome back'}
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          {isSignup
            ? 'Split bills properly - itemised, scanned and settled in the fewest payments.'
            : 'Sign in to pick up where you left off.'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="card space-y-4">
        {isSignup && (
          <div>
            <label className="label" htmlFor="name">Your name</label>
            <input id="name" name="name" className="input" required maxLength={60} autoComplete="name" placeholder="Saakshi Sharma" />
          </div>
        )}

        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" className="input" required autoComplete="email" placeholder="you@example.com" />
        </div>

        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password" name="password" type="password" className="input" required
            minLength={isSignup ? 8 : 1}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            placeholder={isSignup ? 'At least 8 characters' : ''}
          />
        </div>

        {isSignup && (
          <div>
            <label className="label" htmlFor="upiId">UPI ID <span className="normal-case opacity-70">(optional)</span></label>
            <input id="upiId" name="upiId" className="input" maxLength={80} placeholder="you@okhdfcbank" />
            <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              Lets the app build a payment link when somebody settles up with you.
            </p>
          </div>
        )}

        {error && (
          <p
            className="rounded-xl px-3 py-2.5 text-sm font-medium"
            style={{ background: 'color-mix(in srgb, var(--negative) 12%, transparent)', color: 'var(--negative)' }}
            role="alert"
          >
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary w-full" disabled={pending}>
          {pending ? 'One moment...' : isSignup ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        {isSignup ? 'Already have an account? ' : 'New here? '}
        <Link href={isSignup ? '/login' : '/signup'} className="font-semibold" style={{ color: 'var(--accent)' }}>
          {isSignup ? 'Sign in' : 'Create one'}
        </Link>
      </p>
    </main>
  );
}
