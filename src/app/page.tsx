import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { AvatarStack, Badge, EmptyState, Money, Stat } from '@/components/ui';
import { currentUser } from '@/lib/auth';
import { listGroupsForUser } from '@/lib/groups';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const groups = await listGroupsForUser(user.id);

  // Across all groups. Only meaningful when they share a currency, so the
  // headline is suppressed when they do not rather than adding rupees to dollars.
  const currencies = new Set(groups.map((g) => g.currency));
  const singleCurrency = currencies.size === 1 ? [...currencies][0] : null;
  const owedToYou = groups.reduce((t, g) => t + Math.max(0, g.yourNetMinor), 0);
  const youOwe = groups.reduce((t, g) => t + Math.max(0, -g.yourNetMinor), 0);

  return (
    <>
      <TopBar user={user} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Hey {user.name.split(' ')[0]}</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {groups.length === 0
                ? 'Start by creating a group.'
                : `${groups.length} group${groups.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <Link href="/groups/new" className="btn-primary">+ New group</Link>
        </div>

        {singleCurrency && groups.length > 0 && (
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <Stat
              label="You are owed"
              value={<span style={{ color: 'var(--positive)' }}>{formatMoney(owedToYou, singleCurrency)}</span>}
            />
            <Stat
              label="You owe"
              value={<span style={{ color: 'var(--negative)' }}>{formatMoney(youOwe, singleCurrency)}</span>}
            />
            <Stat
              label="Net position"
              value={<Money minor={owedToYou - youOwe} currency={singleCurrency} signed />}
              hint={owedToYou - youOwe === 0 ? 'All square' : undefined}
            />
          </div>
        )}

        {groups.length === 0 ? (
          <div className="card">
            <EmptyState emoji="&#128101;" title="No groups yet">
              A group is any set of people who share costs - flatmates, a trip, a dinner
              that keeps happening. Create one and add your first expense.
            </EmptyState>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {groups.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/groups/${g.id}`}
                  className="card flex h-full flex-col gap-3 transition hover:-translate-y-0.5"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl" aria-hidden>{g.emoji}</span>
                      <div>
                        <p className="font-semibold">{g.name}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {g.expenseCount} expense{g.expenseCount === 1 ? '' : 's'} &middot;{' '}
                          {formatMoney(g.totalMinor, g.currency)} total
                        </p>
                      </div>
                    </div>
                    <AvatarStack people={g.members} />
                  </div>

                  <div className="mt-auto">
                    {g.yourNetMinor === 0 ? (
                      <Badge>Settled up</Badge>
                    ) : g.yourNetMinor > 0 ? (
                      <Badge tone="positive">
                        You are owed {formatMoney(g.yourNetMinor, g.currency)}
                      </Badge>
                    ) : (
                      <Badge tone="negative">
                        You owe {formatMoney(-g.yourNetMinor, g.currency)}
                      </Badge>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
