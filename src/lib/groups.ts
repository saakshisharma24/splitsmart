import 'server-only';

import { prisma } from './db';
import { sum, type Minor } from './money';
import { allocate } from './split/allocate';
import {
  computeNetBalances,
  computePairwiseBalances,
  type LedgerEntry,
  type NetBalances,
  type PairwiseBalances,
  type SettlementEntry,
} from './split/balances';
import { simplificationSavings, simplifyDebts } from './split/simplify';
import type { SplitSpec, Transfer, UserId } from './split/types';
import { analyseGroup, type ExpenseRecord, type GroupAnalytics } from './analytics/summarize';
import { dueOccurrences, type Frequency } from './recurring/schedule';
import type { CreateExpenseInput, CreateGroupInput, CreateRecurringInput } from './validation';

/**
 * The service layer. Routes and pages talk to this; nothing else talks to
 * Prisma directly.
 *
 * The split engine stays pure and the database stays dumb: this module is the
 * only place the two meet. Shares are computed by `allocate()` and then stored
 * as rows, so reading balances is an aggregate over ExpenseShare rather than
 * re-running the engine over every expense on every page load.
 */

export class ServiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'ServiceError';
  }
}

export interface Member {
  id: UserId;
  name: string;
  email: string;
  avatarColor: string;
  upiId: string | null;
  role: string;
}

export interface GroupState {
  group: {
    id: string;
    name: string;
    description: string | null;
    currency: string;
    emoji: string;
  };
  members: Member[];
  expenses: ExpenseRecord[];
  settlements: Array<{
    id: string; from: UserId; to: UserId; amountMinor: Minor; settledAt: Date; method: string; note: string | null;
  }>;
  net: NetBalances;
  pairwise: PairwiseBalances;
  settleUp: Transfer[];
  savings: { before: number; after: number; saved: number };
  analytics: GroupAnalytics;
}

/** Everything a group page needs, in one round trip. */
export async function getGroupState(groupId: string, viewerId?: UserId): Promise<GroupState> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      members: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
      expenses: {
        include: { payments: true, shares: true },
        orderBy: { date: 'desc' },
      },
      settlements: { orderBy: { settledAt: 'desc' } },
    },
  });
  if (!group) throw new ServiceError('That group does not exist', 404);

  const members: Member[] = group.members.map((m) => ({
    id: m.user.id,
    name: m.user.name,
    email: m.user.email,
    avatarColor: m.user.avatarColor,
    upiId: m.user.upiId,
    role: m.role,
  }));

  const expenses: ExpenseRecord[] = group.expenses.map((e) => ({
    id: e.id,
    description: e.description,
    category: e.category,
    totalMinor: e.totalMinor,
    date: e.date,
    payments: Object.fromEntries(e.payments.map((p) => [p.userId, p.amountMinor])),
    shares: Object.fromEntries(e.shares.map((s) => [s.userId, s.amountMinor])),
  }));

  const ledger: LedgerEntry[] = expenses.map((e) => ({
    id: e.id,
    totalMinor: e.totalMinor,
    payments: e.payments,
    allocation: e.shares,
  }));

  const settlements = group.settlements.map((s) => ({
    id: s.id,
    from: s.fromUserId,
    to: s.toUserId,
    amountMinor: s.amountMinor,
    settledAt: s.settledAt,
    method: s.method,
    note: s.note,
  }));
  const settlementEntries: SettlementEntry[] = settlements.map((s) => ({
    id: s.id, from: s.from, to: s.to, amountMinor: s.amountMinor,
  }));

  const net = computeNetBalances(ledger, settlementEntries);
  // Anyone with no activity at all is still a member and should read as settled.
  for (const m of members) net[m.id] ??= 0;

  const pairwise = computePairwiseBalances(ledger, settlementEntries);
  const settleUp = simplifyDebts(net);
  const pairwiseCount = Object.values(pairwise).reduce((n, row) => n + Object.keys(row).length, 0);

  return {
    group: {
      id: group.id,
      name: group.name,
      description: group.description,
      currency: group.currency,
      emoji: group.emoji,
    },
    members,
    expenses,
    settlements,
    net,
    pairwise,
    settleUp,
    savings: simplificationSavings(pairwiseCount, settleUp),
    analytics: analyseGroup(expenses, members.map((m) => m.id), viewerId),
  };
}

/**
 * Write an expense.
 *
 * The engine runs BEFORE the transaction opens: if the split does not
 * reconcile, `allocate()` throws and nothing is written. That ordering is the
 * whole safety property - a half-written expense would corrupt every balance
 * in the group.
 */
export async function createExpense(
  groupId: string,
  authorId: UserId,
  input: CreateExpenseInput,
) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: { select: { userId: true } } },
  });
  if (!group) throw new ServiceError('That group does not exist', 404);

  const memberIds = new Set(group.members.map((m) => m.userId));
  const spec = input.split as SplitSpec;

  for (const uid of referencedUsers(spec, input.payments)) {
    if (!memberIds.has(uid)) {
      throw new ServiceError('That expense references somebody who is not in the group');
    }
  }

  const paid = sum(Object.values(input.payments));
  if (paid !== input.totalMinor) {
    throw new ServiceError(
      `The amounts paid add up to ${paid / 100}, but the expense total is ${input.totalMinor / 100}`,
    );
  }

  let allocation: Record<UserId, Minor>;
  try {
    allocation = allocate(input.totalMinor, spec);
  } catch (err) {
    throw new ServiceError(err instanceof Error ? err.message : 'That split does not add up');
  }

  return prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        groupId,
        description: input.description,
        totalMinor: input.totalMinor,
        currency: group.currency,
        category: input.category,
        splitMode: spec.mode,
        splitSpec: JSON.stringify(spec),
        notes: input.notes ?? null,
        receiptUrl: input.receiptUrl ?? null,
        date: input.date ?? new Date(),
        createdById: authorId,
        payments: {
          create: Object.entries(input.payments)
            .filter(([, amt]) => amt !== 0)
            .map(([userId, amountMinor]) => ({ userId, amountMinor })),
        },
        shares: {
          create: Object.entries(allocation).map(([userId, amountMinor]) => ({ userId, amountMinor })),
        },
        items: spec.mode === 'ITEMIZED'
          ? {
              create: spec.items.map((it, i) => ({
                label: it.label,
                amountMinor: it.amountMinor,
                participantIds: JSON.stringify(it.participants),
                position: i,
              })),
            }
          : undefined,
      },
    });

    await tx.activity.create({
      data: {
        groupId,
        userId: authorId,
        type: 'EXPENSE_ADDED',
        payload: JSON.stringify({
          expenseId: expense.id,
          description: input.description,
          totalMinor: input.totalMinor,
        }),
      },
    });

    return expense;
  });
}

export async function deleteExpense(groupId: string, expenseId: string, actorId: UserId) {
  const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!expense || expense.groupId !== groupId) {
    throw new ServiceError('That expense does not exist', 404);
  }
  return prisma.$transaction(async (tx) => {
    await tx.expense.delete({ where: { id: expenseId } });
    // Logged after the fact so the feed still shows what was removed.
    await tx.activity.create({
      data: {
        groupId,
        userId: actorId,
        type: 'EXPENSE_DELETED',
        payload: JSON.stringify({
          description: expense.description,
          totalMinor: expense.totalMinor,
        }),
      },
    });
  });
}

export async function recordSettlement(
  groupId: string,
  actorId: UserId,
  input: { fromUserId: UserId; toUserId: UserId; amountMinor: Minor; method: string; note?: string },
) {
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    select: { userId: true },
  });
  const ids = new Set(members.map((m) => m.userId));
  if (!ids.has(input.fromUserId) || !ids.has(input.toUserId)) {
    throw new ServiceError('Both people have to be members of the group');
  }

  return prisma.$transaction(async (tx) => {
    const settlement = await tx.settlement.create({
      data: {
        groupId,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        amountMinor: input.amountMinor,
        method: input.method,
        note: input.note ?? null,
      },
    });
    await tx.activity.create({
      data: {
        groupId,
        userId: actorId,
        type: 'SETTLED',
        payload: JSON.stringify({
          from: input.fromUserId, to: input.toUserId, amountMinor: input.amountMinor,
        }),
      },
    });
    return settlement;
  });
}

export async function createGroup(ownerId: UserId, input: CreateGroupInput) {
  const invitees = input.memberEmails.filter((e) => e.length > 0);
  const found = invitees.length
    ? await prisma.user.findMany({ where: { email: { in: invitees } }, select: { id: true, email: true } })
    : [];
  const foundEmails = new Set(found.map((u) => u.email));
  // Unknown emails are reported back rather than silently dropped or
  // auto-created - a ghost account nobody can log into is worse than a message.
  const unknown = invitees.filter((e) => !foundEmails.has(e));

  const memberIds = [...new Set([ownerId, ...found.map((u) => u.id)])];

  const group = await prisma.group.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      currency: input.currency,
      emoji: input.emoji || undefined,
      members: {
        create: memberIds.map((userId) => ({
          userId,
          role: userId === ownerId ? 'ADMIN' : 'MEMBER',
        })),
      },
      activities: {
        create: { userId: ownerId, type: 'MEMBER_JOINED', payload: JSON.stringify({ count: memberIds.length }) },
      },
    },
  });

  return { group, unknownEmails: unknown };
}

export async function addMemberByEmail(groupId: string, actorId: UserId, email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } });
  if (!user) throw new ServiceError('Nobody is signed up with that email address', 404);

  const existing = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  });
  if (existing) throw new ServiceError('They are already in this group');

  await prisma.$transaction([
    prisma.groupMember.create({ data: { groupId, userId: user.id } }),
    prisma.activity.create({
      data: { groupId, userId: actorId, type: 'MEMBER_JOINED', payload: JSON.stringify({ userId: user.id }) },
    }),
  ]);
}

export async function createRecurring(groupId: string, authorId: UserId, input: CreateRecurringInput) {
  const spec = input.split as SplitSpec;
  // Validate the split now so a bad rule cannot quietly fail every month.
  allocate(input.totalMinor, spec);

  const paid = sum(Object.values(input.payments));
  if (paid !== input.totalMinor) {
    throw new ServiceError('The amounts paid do not add up to the expense total');
  }

  return prisma.recurringExpense.create({
    data: {
      groupId,
      description: input.description,
      totalMinor: input.totalMinor,
      category: input.category,
      splitMode: spec.mode,
      splitSpec: JSON.stringify(spec),
      payerSpec: JSON.stringify(input.payments),
      frequency: input.frequency,
      interval: input.interval,
      startDate: input.startDate,
      nextRunAt: input.startDate,
      endDate: input.endDate ?? null,
      createdById: authorId,
    },
  });
}

/**
 * Catch-up scheduler.
 *
 * Called when a group is opened rather than from a cron job - this is a
 * portfolio app that may be sleeping on a free tier, and a rule that only
 * fires when a server happens to be awake is not a rule. Each due occurrence
 * becomes a normal expense dated to the day it was due, not to today.
 */
export async function syncRecurring(groupId: string): Promise<number> {
  const rules = await prisma.recurringExpense.findMany({
    where: { groupId, active: true, nextRunAt: { lte: new Date() } },
  });
  if (rules.length === 0) return 0;

  let created = 0;
  for (const rule of rules) {
    const spec = JSON.parse(rule.splitSpec) as SplitSpec;
    const payments = JSON.parse(rule.payerSpec) as Record<UserId, Minor>;

    const occurrences = dueOccurrences(
      {
        frequency: rule.frequency as Frequency,
        interval: rule.interval,
        startDate: rule.startDate,
        endDate: rule.endDate,
      },
      rule.lastRunAt ? new Date(rule.lastRunAt.getTime() + 86_400_000) : rule.startDate,
      new Date(),
    );
    if (occurrences.length === 0) {
      await prisma.recurringExpense.update({
        where: { id: rule.id },
        data: { active: rule.endDate ? false : rule.active },
      });
      continue;
    }

    let allocation: Record<UserId, Minor>;
    try {
      allocation = allocate(rule.totalMinor, spec);
    } catch {
      // A rule whose members have since left the group would throw every time.
      // Deactivate it rather than failing every page load of the group.
      await prisma.recurringExpense.update({ where: { id: rule.id }, data: { active: false } });
      continue;
    }

    for (const when of occurrences) {
      await prisma.$transaction(async (tx) => {
        await tx.expense.create({
          data: {
            groupId,
            description: rule.description,
            totalMinor: rule.totalMinor,
            currency: rule.currency,
            category: rule.category,
            splitMode: rule.splitMode,
            splitSpec: rule.splitSpec,
            date: when,
            createdById: rule.createdById,
            recurringExpenseId: rule.id,
            payments: {
              create: Object.entries(payments)
                .filter(([, amt]) => amt !== 0)
                .map(([userId, amountMinor]) => ({ userId, amountMinor })),
            },
            shares: {
              create: Object.entries(allocation).map(([userId, amountMinor]) => ({ userId, amountMinor })),
            },
          },
        });
        await tx.activity.create({
          data: {
            groupId,
            userId: rule.createdById,
            type: 'RECURRING_FIRED',
            payload: JSON.stringify({ description: rule.description, totalMinor: rule.totalMinor }),
          },
        });
      });
      created++;
    }

    const last = occurrences[occurrences.length - 1];
    await prisma.recurringExpense.update({
      where: { id: rule.id },
      data: {
        lastRunAt: last,
        nextRunAt: new Date(last.getTime() + 86_400_000),
      },
    });
  }
  return created;
}

/** Every group the user belongs to, with their own net position in each. */
export async function listGroupsForUser(userId: UserId) {
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    include: {
      group: {
        include: {
          members: { select: { userId: true, user: { select: { name: true, avatarColor: true } } } },
          expenses: { include: { payments: true, shares: true } },
          settlements: true,
        },
      },
    },
    orderBy: { joinedAt: 'desc' },
  });

  return memberships
    .filter((m) => !m.group.archivedAt)
    .map((m) => {
      const ledger: LedgerEntry[] = m.group.expenses.map((e) => ({
        id: e.id,
        totalMinor: e.totalMinor,
        payments: Object.fromEntries(e.payments.map((p) => [p.userId, p.amountMinor])),
        allocation: Object.fromEntries(e.shares.map((s) => [s.userId, s.amountMinor])),
      }));
      const net = computeNetBalances(
        ledger,
        m.group.settlements.map((s) => ({
          id: s.id, from: s.fromUserId, to: s.toUserId, amountMinor: s.amountMinor,
        })),
      );
      return {
        id: m.group.id,
        name: m.group.name,
        emoji: m.group.emoji,
        currency: m.group.currency,
        memberCount: m.group.members.length,
        members: m.group.members.map((gm) => gm.user),
        expenseCount: m.group.expenses.length,
        totalMinor: sum(m.group.expenses.map((e) => e.totalMinor)),
        yourNetMinor: net[userId] ?? 0,
      };
    });
}

export async function getActivity(groupId: string, limit = 30) {
  return prisma.activity.findMany({
    where: { groupId },
    include: { user: { select: { name: true, avatarColor: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/** Every user id a split or payment map mentions. */
function referencedUsers(spec: SplitSpec, payments: Record<UserId, Minor>): UserId[] {
  const ids = new Set<UserId>(Object.keys(payments));
  switch (spec.mode) {
    case 'EQUAL':
      spec.participants.forEach((u) => ids.add(u));
      break;
    case 'EXACT':
      Object.keys(spec.amounts).forEach((u) => ids.add(u));
      break;
    case 'PERCENT':
      Object.keys(spec.basisPoints).forEach((u) => ids.add(u));
      break;
    case 'SHARES':
      Object.keys(spec.shares).forEach((u) => ids.add(u));
      break;
    case 'ITEMIZED':
      spec.participants.forEach((u) => ids.add(u));
      spec.items.forEach((i) => i.participants.forEach((u) => ids.add(u)));
      break;
  }
  return [...ids];
}
