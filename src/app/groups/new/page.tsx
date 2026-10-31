import { redirect } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { NewGroupForm } from '@/components/NewGroupForm';
import { currentUser } from '@/lib/auth';

export default async function NewGroupPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return (
    <>
      <TopBar user={user} back={{ href: '/', label: 'Groups' }} />
      <main className="mx-auto max-w-lg px-4 py-6">
        <h1 className="mb-1 text-2xl font-bold">New group</h1>
        <p className="mb-6 text-sm" style={{ color: 'var(--text-muted)' }}>
          Flatmates, a trip, a running dinner tab - anything with shared costs.
        </p>
        <NewGroupForm />
      </main>
    </>
  );
}
