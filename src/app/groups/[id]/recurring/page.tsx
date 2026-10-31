import { notFound, redirect } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { RecurringManager } from '@/components/RecurringManager';
import { currentUser, ForbiddenError, requireMembership } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getGroupState, syncRecurring } from '@/lib/groups';

export const dynamic = 'force-dynamic';

export default async function RecurringPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect('/login');

  try {
    await requireMembership(user.id, id);
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  await syncRecurring(id);
  const { group, members } = await getGroupState(id, user.id);
  const rules = await prisma.recurringExpense.findMany({
    where: { groupId: id },
    orderBy: [{ active: 'desc' }, { nextRunAt: 'asc' }],
  });

  return (
    <>
      <TopBar user={user} back={{ href: `/groups/${id}`, label: group.name }} />
      <main className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="mb-1 text-2xl font-bold">Recurring expenses</h1>
        <p className="mb-6 text-sm" style={{ color: 'var(--text-muted)' }}>
          Things that happen on a schedule, recorded without anyone remembering to.
        </p>

        <RecurringManager
          groupId={id}
          currency={group.currency}
          members={members.map((m) => ({ id: m.id, name: m.name, avatarColor: m.avatarColor }))}
          viewerId={user.id}
          rules={rules.map((r) => ({
            id: r.id,
            description: r.description,
            totalMinor: r.totalMinor,
            category: r.category,
            frequency: r.frequency,
            interval: r.interval,
            startDate: r.startDate.toISOString(),
            nextRunAt: r.nextRunAt.toISOString(),
            endDate: r.endDate?.toISOString() ?? null,
            active: r.active,
          }))}
        />
      </main>
    </>
  );
}
