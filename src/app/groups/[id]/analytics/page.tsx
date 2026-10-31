import { notFound, redirect } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { Analytics } from '@/components/Analytics';
import { currentUser, ForbiddenError, requireMembership } from '@/lib/auth';
import { getGroupState } from '@/lib/groups';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect('/login');

  try {
    await requireMembership(user.id, id);
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const { group, members, analytics } = await getGroupState(id, user.id);

  return (
    <>
      <TopBar user={user} back={{ href: `/groups/${id}`, label: group.name }} />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Analytics</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{group.name}</p>
          </div>
          <div className="flex gap-2">
            <a href={`/api/groups/${id}/export?format=xlsx`} className="btn-ghost">Excel</a>
            <a href={`/api/groups/${id}/export?format=csv`} className="btn-ghost">CSV</a>
          </div>
        </div>

        <Analytics
          currency={group.currency}
          viewerId={user.id}
          members={members.map((m) => ({ id: m.id, name: m.name, avatarColor: m.avatarColor }))}
          byCategory={analytics.byCategory}
          byMonth={analytics.byMonth}
          byMember={analytics.byMember}
          totalMinor={analytics.totalMinor}
          yourShareMinor={analytics.yourShareMinor}
          averageMinor={analytics.averageMinor}
          expenseCount={analytics.expenseCount}
        />
      </main>
    </>
  );
}
