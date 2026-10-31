'use client';

import { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Avatar, Stat } from './ui';
import { categoryMeta } from '@/lib/analytics/summarize';
import { formatMinor, formatMoney, exponentOf, type Minor } from '@/lib/money';

/**
 * Chart notes, so the choices here are not mistaken for taste:
 *
 * - Category spend is ONE hue, not eleven. Identity is already carried by the
 *   axis labels, so colouring each bar differently would be decoration that
 *   also breaks colour-blind separation across eleven categories.
 * - Two-series charts use the validated blue/orange pair, which clears CVD and
 *   normal-vision separation in both light and dark mode. Dark steps are
 *   chosen for the dark surface, not flipped automatically.
 * - Every chart has a table view behind it. That is the required relief for
 *   the one slot that sits under 3:1 contrast on the light surface, and it is
 *   also just the honest way to publish numbers.
 * - No dual axes anywhere. Ever.
 */

interface Member { id: string; name: string; avatarColor: string }

interface Props {
  currency: string;
  viewerId: string;
  members: Member[];
  byCategory: Array<{ category: string; totalMinor: Minor; count: number; share: number }>;
  byMonth: Array<{ month: string; label: string; totalMinor: Minor; yourShareMinor: Minor; count: number }>;
  byMember: Array<{ userId: string; paidMinor: Minor; owedMinor: Minor; netMinor: Minor; expenseCount: number }>;
  totalMinor: Minor;
  yourShareMinor: Minor;
  averageMinor: Minor;
  expenseCount: number;
}

export function Analytics(props: Props) {
  const { currency } = props;
  const major = (m: Minor) => m / 10 ** exponentOf(currency);
  const nameOf = new Map(props.members.map((m) => [m.id, m.name]));

  const categoryData = props.byCategory.map((c) => ({
    name: categoryMeta(c.category).label,
    emoji: categoryMeta(c.category).emoji,
    value: major(c.totalMinor),
    minor: c.totalMinor,
    count: c.count,
    share: c.share,
  }));

  const monthData = props.byMonth.map((m) => ({
    name: m.label,
    group: major(m.totalMinor),
    yours: major(m.yourShareMinor),
    groupMinor: m.totalMinor,
    yoursMinor: m.yourShareMinor,
  }));

  const memberData = props.byMember.map((m) => ({
    name: nameOf.get(m.userId) ?? m.userId,
    paid: major(m.paidMinor),
    owed: major(m.owedMinor),
    paidMinor: m.paidMinor,
    owedMinor: m.owedMinor,
    net: m.netMinor,
  }));

  if (props.expenseCount === 0) {
    return (
      <div className="card py-16 text-center">
        <p className="text-4xl">&#128202;</p>
        <p className="mt-2 font-semibold">Nothing to chart yet</p>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Add a few expenses and the breakdowns will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="viz-root space-y-5">
      <style>{VIZ_TOKENS}</style>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Total spend" value={formatMoney(props.totalMinor, currency)} />
        <Stat label="Your share" value={formatMoney(props.yourShareMinor, currency)}
              hint={props.totalMinor ? `${Math.round((props.yourShareMinor / props.totalMinor) * 100)}% of the group` : undefined} />
        <Stat label="Average expense" value={formatMoney(props.averageMinor, currency)} />
        <Stat label="Expenses" value={props.expenseCount} />
      </div>

      <ChartCard
        title="Where the money goes"
        subtitle="Total spend per category, highest first"
        table={
          <SimpleTable
            head={['Category', 'Total', 'Expenses', 'Share']}
            rows={categoryData.map((c) => [
              `${c.emoji} ${c.name}`,
              formatMoney(c.minor, currency),
              String(c.count),
              `${(c.share * 100).toFixed(1)}%`,
            ])}
          />
        }
      >
        <ResponsiveContainer width="100%" height={Math.max(180, categoryData.length * 38)}>
          <BarChart
            data={categoryData}
            layout="vertical"
            margin={{ top: 4, right: 72, bottom: 4, left: 8 }}
            barCategoryGap={6}
          >
            <CartesianGrid horizontal={false} stroke="var(--viz-grid)" strokeDasharray="2 4" />
            <XAxis type="number" hide />
            <YAxis
              type="category" dataKey="name" width={110}
              tickLine={false} axisLine={false}
              tick={{ fill: 'var(--viz-text-secondary)', fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: 'var(--viz-hover)' }}
              content={<CategoryTooltip currency={currency} />}
            />
            {/* One hue: the axis labels already carry identity. */}
            <Bar dataKey="value" fill="var(--viz-series-1)" radius={[0, 4, 4, 0]} maxBarSize={18}>
              <LabelList
                dataKey="minor"
                position="right"
                formatter={(v: number) => formatMoney(v, currency)}
                style={{ fill: 'var(--viz-text-primary)', fontSize: 11, fontWeight: 600 }}
              />
              {categoryData.map((_, i) => <Cell key={i} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {monthData.length > 1 && (
        <ChartCard
          title="Spend over time"
          subtitle="The whole group against your own share, month by month"
          table={
            <SimpleTable
              head={['Month', 'Group', 'Your share']}
              rows={monthData.map((m) => [
                m.name, formatMoney(m.groupMinor, currency), formatMoney(m.yoursMinor, currency),
              ])}
            />
          }
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={monthData} margin={{ top: 16, right: 8, bottom: 4, left: 8 }} barGap={2}>
              <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeDasharray="2 4" />
              <XAxis
                dataKey="name" tickLine={false} axisLine={false}
                tick={{ fill: 'var(--viz-text-secondary)', fontSize: 12 }}
              />
              <YAxis
                tickLine={false} axisLine={false} width={56}
                tick={{ fill: 'var(--viz-text-secondary)', fontSize: 11 }}
                tickFormatter={(v: number) => compact(v)}
              />
              <Tooltip cursor={{ fill: 'var(--viz-hover)' }} content={<MonthTooltip currency={currency} />} />
              <Legend
                verticalAlign="top" align="left" height={28}
                formatter={(value) => (
                  <span style={{ color: 'var(--viz-text-secondary)', fontSize: 12 }}>{value}</span>
                )}
              />
              <Bar name="Group total" dataKey="group" fill="var(--viz-series-1)" radius={[4, 4, 0, 0]} maxBarSize={34} />
              <Bar name="Your share" dataKey="yours" fill="var(--viz-series-2)" radius={[4, 4, 0, 0]} maxBarSize={34} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      <ChartCard
        title="Paid against owed"
        subtitle="Who has been fronting the money"
        table={
          <SimpleTable
            head={['Member', 'Paid', 'Owed', 'Net']}
            rows={memberData.map((m) => [
              m.name,
              formatMoney(m.paidMinor, currency),
              formatMoney(m.owedMinor, currency),
              formatMoney(m.net, currency),
            ])}
          />
        }
      >
        <ResponsiveContainer width="100%" height={Math.max(200, memberData.length * 62)}>
          <BarChart
            data={memberData} layout="vertical"
            margin={{ top: 16, right: 16, bottom: 4, left: 8 }} barGap={2}
          >
            <CartesianGrid horizontal={false} stroke="var(--viz-grid)" strokeDasharray="2 4" />
            <XAxis type="number" tickLine={false} axisLine={false}
                   tick={{ fill: 'var(--viz-text-secondary)', fontSize: 11 }}
                   tickFormatter={(v: number) => compact(v)} />
            <YAxis type="category" dataKey="name" width={100} tickLine={false} axisLine={false}
                   tick={{ fill: 'var(--viz-text-secondary)', fontSize: 12 }} />
            <Tooltip cursor={{ fill: 'var(--viz-hover)' }} content={<MemberTooltip currency={currency} />} />
            <Legend
              verticalAlign="top" align="left" height={28}
              formatter={(value) => (
                <span style={{ color: 'var(--viz-text-secondary)', fontSize: 12 }}>{value}</span>
              )}
            />
            <Bar name="Paid" dataKey="paid" fill="var(--viz-series-1)" radius={[0, 4, 4, 0]} maxBarSize={16} />
            <Bar name="Owed" dataKey="owed" fill="var(--viz-series-2)" radius={[0, 4, 4, 0]} maxBarSize={16} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="card">
        <h2 className="mb-3 font-semibold">Standing per member</h2>
        <ul className="space-y-2">
          {props.byMember.map((m) => {
            const member = props.members.find((x) => x.id === m.userId);
            return (
              <li key={m.userId} className="flex items-center gap-3">
                <Avatar name={member?.name ?? '?'} color={member?.avatarColor ?? '#888'} size={30} />
                <span className="flex-1 truncate text-sm font-medium">
                  {m.userId === props.viewerId ? 'You' : member?.name}
                </span>
                <span className="text-right text-sm">
                  <span className="block tabular font-semibold"
                        style={{ color: m.netMinor > 0 ? 'var(--positive)' : m.netMinor < 0 ? 'var(--negative)' : 'var(--text-muted)' }}>
                    {formatMoney(m.netMinor, currency)}
                  </span>
                  <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                    paid {formatMoney(m.paidMinor, currency)} &middot; owed {formatMoney(m.owedMinor, currency)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function ChartCard({
  title, subtitle, children, table,
}: { title: string; subtitle: string; children: React.ReactNode; table: React.ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>
        </div>
        <button
          className="text-xs font-semibold"
          style={{ color: 'var(--accent)' }}
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
        >
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {showTable ? table : children}
    </section>
  );
}

function SimpleTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
            {head.map((h, i) => (
              <th key={h} className={`py-2 text-xs font-semibold uppercase tracking-wide ${i === 0 ? 'text-left' : 'text-right'}`}
                  style={{ color: 'var(--text-muted)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
              {r.map((cell, j) => (
                <td key={j} className={`py-2 ${j === 0 ? 'text-left' : 'text-right tabular'}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface TipProps { active?: boolean; payload?: Array<{ payload: Record<string, unknown> }> }

function TooltipShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border px-3 py-2 text-xs shadow-lg"
         style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}>
      {children}
    </div>
  );
}

function CategoryTooltip({ active, payload, currency }: TipProps & { currency: string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as { name: string; minor: number; count: number; share: number };
  return (
    <TooltipShell>
      <p className="font-semibold">{d.name}</p>
      <p className="tabular">{formatMoney(d.minor, currency)}</p>
      <p style={{ color: 'var(--text-muted)' }}>
        {d.count} expense{d.count === 1 ? '' : 's'} &middot; {(d.share * 100).toFixed(1)}% of spend
      </p>
    </TooltipShell>
  );
}

function MonthTooltip({ active, payload, currency }: TipProps & { currency: string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as { name: string; groupMinor: number; yoursMinor: number };
  return (
    <TooltipShell>
      <p className="font-semibold">{d.name}</p>
      <p className="tabular">Group {formatMoney(d.groupMinor, currency)}</p>
      <p className="tabular" style={{ color: 'var(--text-muted)' }}>
        You {formatMoney(d.yoursMinor, currency)}
      </p>
    </TooltipShell>
  );
}

function MemberTooltip({ active, payload, currency }: TipProps & { currency: string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as { name: string; paidMinor: number; owedMinor: number; net: number };
  return (
    <TooltipShell>
      <p className="font-semibold">{d.name}</p>
      <p className="tabular">Paid {formatMoney(d.paidMinor, currency)}</p>
      <p className="tabular">Owed {formatMoney(d.owedMinor, currency)}</p>
      <p className="tabular font-semibold"
         style={{ color: d.net > 0 ? 'var(--positive)' : d.net < 0 ? 'var(--negative)' : 'var(--text-muted)' }}>
        Net {formatMoney(d.net, currency)}
      </p>
    </TooltipShell>
  );
}

/** Axis ticks only - never used for a value the reader has to trust exactly. */
function compact(v: number): string {
  if (Math.abs(v) >= 10_000_000) return `${(v / 10_000_000).toFixed(1)}Cr`;
  if (Math.abs(v) >= 100_000) return `${(v / 100_000).toFixed(1)}L`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return String(v);
}

/**
 * Chart tokens. Dark steps are chosen for the dark surface, not flipped from
 * the light ones. Both the OS media query and an explicit data-theme stamp are
 * covered, with the stamp winning either way.
 */
const VIZ_TOKENS = `
.viz-root {
  --viz-series-1: #2a78d6;
  --viz-series-2: #eb6834;
  --viz-grid: #d5d9e2;
  --viz-hover: rgba(17, 19, 24, 0.04);
  --viz-text-primary: #1b1e27;
  --viz-text-secondary: #66738f;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .viz-root {
    --viz-series-1: #3987e5;
    --viz-series-2: #d95926;
    --viz-grid: #2b303d;
    --viz-hover: rgba(236, 238, 242, 0.06);
    --viz-text-primary: #eceef2;
    --viz-text-secondary: #8591aa;
  }
}
:root[data-theme='dark'] .viz-root {
  --viz-series-1: #3987e5;
  --viz-series-2: #d95926;
  --viz-grid: #2b303d;
  --viz-hover: rgba(236, 238, 242, 0.06);
  --viz-text-primary: #eceef2;
  --viz-text-secondary: #8591aa;
}
`;
