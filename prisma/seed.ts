/**
 * Demo data, so a fresh clone opens on a populated app instead of an empty
 * shell. Every password is "password123" - this is sample data, not a secret.
 *
 *   npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { allocate } from '../src/lib/split/allocate';
import type { SplitSpec } from '../src/lib/split/types';

const prisma = new PrismaClient();

const PEOPLE = [
  { name: 'Ari Mehta',     email: 'ari@example.com',   color: '#10b981', upi: 'ari@okhdfcbank' },
  { name: 'Sam Verghese',  email: 'sam@example.com',   color: '#6366f1', upi: 'sam@okaxis' },
  { name: 'Priya Nair',    email: 'priya@example.com', color: '#f97316', upi: 'priya@oksbi' },
  { name: 'Dev Khanna',    email: 'dev@example.com',   color: '#ec4899', upi: null },
];

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d;
};

async function main() {
  console.log('Clearing existing data...');
  // Order matters: children before parents, since SQLite enforces the FKs.
  await prisma.activity.deleteMany();
  await prisma.expenseItem.deleteMany();
  await prisma.expenseShare.deleteMany();
  await prisma.expensePayment.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.recurringExpense.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.group.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash('password123', 12);

  console.log('Creating people...');
  const users = await Promise.all(
    PEOPLE.map((p) =>
      prisma.user.create({
        data: {
          name: p.name, email: p.email, passwordHash,
          avatarColor: p.color, upiId: p.upi,
        },
      }),
    ),
  );
  const [ari, sam, priya, dev] = users.map((u) => u.id);

  console.log('Creating groups...');
  const flat = await prisma.group.create({
    data: {
      name: 'Flat 302',
      description: 'Rent, bills and the weekly grocery run',
      currency: 'INR',
      emoji: '\u{1F3E0}',
      members: {
        create: [
          { userId: ari, role: 'ADMIN' },
          { userId: sam }, { userId: priya },
        ],
      },
    },
  });

  const trip = await prisma.group.create({
    data: {
      name: 'Goa, March',
      description: 'Four days, too much seafood',
      currency: 'INR',
      emoji: '\u{1F3D6}\u{FE0F}',
      members: {
        create: [
          { userId: ari, role: 'ADMIN' },
          { userId: sam }, { userId: priya }, { userId: dev },
        ],
      },
    },
  });

  async function addExpense(opts: {
    groupId: string; description: string; category: string; totalMinor: number;
    date: Date; payments: Record<string, number>; split: SplitSpec; createdById: string;
  }) {
    const allocation = allocate(opts.totalMinor, opts.split);
    const expense = await prisma.expense.create({
      data: {
        groupId: opts.groupId,
        description: opts.description,
        totalMinor: opts.totalMinor,
        category: opts.category,
        splitMode: opts.split.mode,
        splitSpec: JSON.stringify(opts.split),
        date: opts.date,
        createdById: opts.createdById,
        payments: {
          create: Object.entries(opts.payments).map(([userId, amountMinor]) => ({ userId, amountMinor })),
        },
        shares: {
          create: Object.entries(allocation).map(([userId, amountMinor]) => ({ userId, amountMinor })),
        },
        items: opts.split.mode === 'ITEMIZED'
          ? {
              create: opts.split.items.map((it, i) => ({
                label: it.label,
                amountMinor: it.amountMinor,
                participantIds: JSON.stringify(it.participants),
                position: i,
              })),
            }
          : undefined,
      },
    });
    await prisma.activity.create({
      data: {
        groupId: opts.groupId, userId: opts.createdById, type: 'EXPENSE_ADDED',
        payload: JSON.stringify({
          expenseId: expense.id, description: opts.description, totalMinor: opts.totalMinor,
        }),
      },
    });
    return expense;
  }

  console.log('Adding flat expenses...');

  // EQUAL - the common case.
  await addExpense({
    groupId: flat.id, description: 'Rent for March', category: 'RENT',
    totalMinor: 4_500_000, date: daysAgo(28), createdById: ari,
    payments: { [ari]: 4_500_000 },
    split: { mode: 'EQUAL', participants: [ari, sam, priya] },
  });

  // SHARES - Priya has the big room, so she pays a larger share.
  await addExpense({
    groupId: flat.id, description: 'Electricity bill', category: 'UTILITIES',
    totalMinor: 384_000, date: daysAgo(22), createdById: sam,
    payments: { [sam]: 384_000 },
    split: { mode: 'SHARES', shares: { [ari]: 1, [sam]: 1, [priya]: 2 } },
  });

  await addExpense({
    groupId: flat.id, description: 'Weekly groceries', category: 'GROCERIES',
    totalMinor: 267_500, date: daysAgo(14), createdById: priya,
    payments: { [priya]: 267_500 },
    split: { mode: 'EQUAL', participants: [ari, sam, priya] },
  });

  // EXACT - Ari ordered the expensive half.
  await addExpense({
    groupId: flat.id, description: 'Pharmacy run', category: 'HEALTH',
    totalMinor: 142_000, date: daysAgo(9), createdById: ari,
    payments: { [ari]: 142_000 },
    split: { mode: 'EXACT', amounts: { [ari]: 92_000, [sam]: 50_000 } },
  });

  // ITEMIZED - the restaurant case, with tax and service charge.
  // items 120000 + tax 6000 + tip 12000 = 138000
  await addExpense({
    groupId: flat.id, description: 'Dinner at Barbeque Corner', category: 'FOOD',
    totalMinor: 138_000, date: daysAgo(4), createdById: sam,
    payments: { [sam]: 138_000 },
    split: {
      mode: 'ITEMIZED',
      participants: [ari, sam, priya],
      items: [
        { id: 'i1', label: 'Paneer Tikka', amountMinor: 45_000, participants: [ari] },
        { id: 'i2', label: 'Dal Makhani', amountMinor: 32_000, participants: [sam] },
        { id: 'i3', label: 'Butter Naan basket', amountMinor: 18_000, participants: [] },
        { id: 'i4', label: 'Gulab Jamun', amountMinor: 14_000, participants: [priya] },
        { id: 'i5', label: 'Masala Chai', amountMinor: 11_000, participants: [ari, sam] },
      ],
      taxMinor: 6_000,
      tipMinor: 12_000,
    },
  });

  console.log('Adding trip expenses...');

  await addExpense({
    groupId: trip.id, description: 'Beach villa, 3 nights', category: 'TRAVEL',
    totalMinor: 2_400_000, date: daysAgo(20), createdById: priya,
    payments: { [priya]: 2_400_000 },
    split: { mode: 'EQUAL', participants: [ari, sam, priya, dev] },
  });

  // Several people fronting one bill.
  await addExpense({
    groupId: trip.id, description: 'Flights', category: 'TRAVEL',
    totalMinor: 3_200_000, date: daysAgo(35), createdById: ari,
    payments: { [ari]: 1_600_000, [dev]: 1_600_000 },
    split: { mode: 'EQUAL', participants: [ari, sam, priya, dev] },
  });

  // PERCENT - Dev drove, so he is carrying less of the fuel.
  await addExpense({
    groupId: trip.id, description: 'Car rental and fuel', category: 'TRANSPORT',
    totalMinor: 860_000, date: daysAgo(19), createdById: dev,
    payments: { [dev]: 860_000 },
    split: {
      mode: 'PERCENT',
      basisPoints: { [ari]: 3_000, [sam]: 3_000, [priya]: 3_000, [dev]: 1_000 },
    },
  });

  await addExpense({
    groupId: trip.id, description: 'Seafood shack, night two', category: 'FOOD',
    totalMinor: 528_000, date: daysAgo(18), createdById: sam,
    payments: { [sam]: 528_000 },
    split: { mode: 'EQUAL', participants: [ari, sam, priya, dev] },
  });

  await addExpense({
    groupId: trip.id, description: 'Scuba diving', category: 'ENTERTAINMENT',
    totalMinor: 960_000, date: daysAgo(17), createdById: ari,
    payments: { [ari]: 960_000 },
    // Sam sat this one out.
    split: { mode: 'EQUAL', participants: [ari, priya, dev] },
  });

  console.log('Recording a settlement...');
  await prisma.settlement.create({
    data: {
      groupId: flat.id, fromUserId: sam, toUserId: ari,
      amountMinor: 500_000, method: 'UPI', note: 'Part of March rent',
      settledAt: daysAgo(6),
    },
  });
  await prisma.activity.create({
    data: {
      groupId: flat.id, userId: sam, type: 'SETTLED',
      payload: JSON.stringify({ from: sam, to: ari, amountMinor: 500_000 }),
    },
  });

  console.log('Adding recurring rules...');
  const firstOfNextCycle = new Date();
  firstOfNextCycle.setDate(1);
  firstOfNextCycle.setHours(12, 0, 0, 0);

  await prisma.recurringExpense.create({
    data: {
      groupId: flat.id, description: 'Monthly rent', totalMinor: 4_500_000,
      category: 'RENT', splitMode: 'EQUAL',
      splitSpec: JSON.stringify({ mode: 'EQUAL', participants: [ari, sam, priya] }),
      payerSpec: JSON.stringify({ [ari]: 4_500_000 }),
      frequency: 'MONTHLY', interval: 1,
      // Dated forward so seeding does not immediately generate a duplicate of
      // the March rent expense above.
      startDate: new Date(firstOfNextCycle.getTime() + 32 * 86_400_000),
      nextRunAt: new Date(firstOfNextCycle.getTime() + 32 * 86_400_000),
      createdById: ari,
    },
  });

  await prisma.recurringExpense.create({
    data: {
      groupId: flat.id, description: 'Netflix', totalMinor: 64_900,
      category: 'SUBSCRIPTIONS', splitMode: 'EQUAL',
      splitSpec: JSON.stringify({ mode: 'EQUAL', participants: [ari, sam, priya] }),
      payerSpec: JSON.stringify({ [priya]: 64_900 }),
      frequency: 'MONTHLY', interval: 1,
      startDate: new Date(firstOfNextCycle.getTime() + 40 * 86_400_000),
      nextRunAt: new Date(firstOfNextCycle.getTime() + 40 * 86_400_000),
      createdById: priya,
    },
  });

  console.log('\nDone. Sign in with any of:');
  for (const p of PEOPLE) console.log(`  ${p.email}  /  password123`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
