import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-5xl">&#129300;</p>
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        That page does not exist, or you are not a member of that group.
      </p>
      <Link href="/" className="btn-primary mt-2">Back to your groups</Link>
    </main>
  );
}
