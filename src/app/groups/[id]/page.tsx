import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { BalanceList, SettleUpCard } from '@/components/SettleUpCard';
import { ExpenseList } from '@/components/ExpenseList';
import { Avatar, EmptyState, Money, Stat } from '@/components/ui';
import { currentUser, requireMembership } from '@/lib/auth';
import { getActivity, getGroupState, syncRecurring } from '@/lib/groups';
import { ForbiddenError } from '@/lib/auth';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect('/login');

  try {
    await requireMembership(user.id, id);
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  // Generate any recurring expenses that fell due since the last visit. Done
  // before reading state so the page reflects them immediately.
  await syncRecurring(id);

  const state = await getGroupState(id, user.id);
  const activity = await getActivity(id, 12);
  const { group, members, expenses, net, settleUp, savings, analytics } = state;
  const yourNet = net[user.id] ?? 0;

  return (
    <>
      <TopBar user={user} back={{ href: '/', label: 'Groups' }} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl" aria-hidden>{group.emoji}</span>
            <div>
              <h1 className="text-2xl font-bold">{group.name}</h1>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {group.description || `${members.length} members · ${group.currency}`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/groups/${id}/analytics`} className="btn-ghost">Analytics</Link>
            <Link href={`/groups/${id}/recurring`} className="btn-ghost">Recurring</Link>
            <a href={`/api/groups/${id}/export?format=xlsx`} className="btn-ghost">Export</a>
            <Link href={`/groups/${id}/add`} className="btn-primary">+ Add expense</Link>
          </div>
        </div>

        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <Stat
            label="Your position"
            value={<Money minor={yourNet} currency={group.currency} signed />}
            hint={yourNet > 0 ? 'The group owes you' : yourNet < 0 ? 'You owe the group' : 'All square'}
          />
          <Stat label="Group spend" value={formatMoney(analytics.totalMinor, group.currency)}
                hint={`${expenses.length} expense${expenses.length === 1 ? '' : 's'}`} />
          <Stat label="Your share" value={formatMoney(analytics.yourShareMinor, group.currency)}
                hint={analytics.topCategory ? `Most on ${analytics.topCategory.category.toLowerCase()}` : undefined} />
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            <SettleUpCard
              groupId={id}
              currency={group.currency}
              transfers={settleUp}
              members={members}
              viewerId={user.id}
              savings={savings}
            />

            <div className="card">
              <h2 className="mb-3 font-semibold">Expenses</h2>
              {expenses.length === 0 ? (
                <EmptyState emoji="&#129534;" title="Nothing here yet">
                  Add the first expense and the balances will work themselves out.
                </EmptyState>
              ) : (
                <ExpenseList
                  groupId={id}
                  currency={group.currency}
                  expenses={expenses.map((e) => ({
                    ...e,
                    date: e.date.toISOString(),
                  }))}
                  members={members}
                  viewerId={user.id}
                />
              )}
            </div>
          </div>

          <aside className="space-y-5">
            <div className="card">
              <h2 className="mb-3 font-semibold">Balances</h2>
              <BalanceList members={members} net={net} currency={group.currency} viewerId={user.id} />
            </div>

            <div className="card">
              <h2 className="mb-3 font-semibold">Members</h2>
              <ul className="space-y-2">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center gap-2.5">
                    <Avatar name={m.name} color={m.avatarColor} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {m.id === user.id ? `${m.name} (you)` : m.name}
                      </span>
                      <span className="block truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                        {m.email}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {activity.length > 0 && (
              <div className="card">
                <h2 className="mb-3 font-semibold">Recent activity</h2>
                <ul className="space-y-2.5">
                  {activity.map((a) => {
                    const payload = JSON.parse(a.payload || '{}') as Record<string, unknown>;
                    return (
                      <li key={a.id} className="flex gap-2.5 text-sm">
                        <Avatar name={a.user.name} color={a.user.avatarColor} size={24} />
                        <span className="min-w-0 flex-1">
                          <span style={{ color: 'var(--text-muted)' }}>
                            {describeActivity(a.type, a.user.name, payload, group.currency)}
                          </span>
                          <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                            {a.createdAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}

function describeActivity(
  type: string, actor: string, payload: Record<string, unknown>, currency: string,
): string {
  const amount = typeof payload.totalMinor === 'number'
    ? formatMoney(payload.totalMinor, currency)
    : typeof payload.amountMinor === 'number'
      ? formatMoney(payload.amountMinor, currency)
      : '';
  const what = typeof payload.description === 'string' ? payload.description : '';

  switch (type) {
    case 'EXPENSE_ADDED':   return `${actor} added "${what}" for ${amount}`;
    case 'EXPENSE_DELETED': return `${actor} deleted "${what}"`;
    case 'SETTLED':         return `${actor} recorded a settlement of ${amount}`;
    case 'RECURRING_FIRED': return `"${what}" recurred for ${amount}`;
    case 'MEMBER_JOINED':   return `${actor} updated the member list`;
    default:                return `${actor} made a change`;
  }
}
