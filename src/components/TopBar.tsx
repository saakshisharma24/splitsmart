'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar } from './ui';

export function TopBar({
  user, back,
}: {
  user: { name: string; avatarColor: string };
  back?: { href: string; label: string };
}) {
  const router = useRouter();

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <header
      className="sticky top-0 z-20 border-b backdrop-blur"
      style={{ background: 'color-mix(in srgb, var(--bg) 85%, transparent)', borderColor: 'var(--border)' }}
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        {back ? (
          <Link href={back.href} className="flex items-center gap-1.5 text-sm font-semibold hover:opacity-70">
            <span aria-hidden>&larr;</span>
            <span className="max-w-[40vw] truncate">{back.label}</span>
          </Link>
        ) : (
          <Link href="/" className="flex items-center gap-2 font-bold">
            <span aria-hidden>&#128184;</span>
            <span>SplitSmart</span>
          </Link>
        )}

        <div className="flex items-center gap-3">
          <Avatar name={user.name} color={user.avatarColor} size={30} />
          <button onClick={signOut} className="text-sm font-medium hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
