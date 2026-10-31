import { notFound, redirect } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { AddExpenseForm } from '@/components/AddExpenseForm';
import { currentUser, ForbiddenError, requireMembership } from '@/lib/auth';
import { getGroupState } from '@/lib/groups';

export const dynamic = 'force-dynamic';

export default async function AddExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect('/login');

  try {
    await requireMembership(user.id, id);
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const { group, members } = await getGroupState(id, user.id);

  return (
    <>
      <TopBar user={user} back={{ href: `/groups/${id}`, label: group.name }} />
      <main className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-bold">Add an expense</h1>
        <AddExpenseForm
          groupId={id}
          currency={group.currency}
          members={members.map((m) => ({ id: m.id, name: m.name, avatarColor: m.avatarColor }))}
          viewerId={user.id}
        />
      </main>
    </>
  );
}
