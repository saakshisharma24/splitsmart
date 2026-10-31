import { NextResponse } from 'next/server';
import { errorResponse, readJson } from '@/lib/api';
import { requireMembership, requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createRecurring, syncRecurring } from '@/lib/groups';
import { createRecurringSchema } from '@/lib/validation';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireUser();
    await requireMembership(user.id, id);
    const rules = await prisma.recurringExpense.findMany({
      where: { groupId: id },
      orderBy: [{ active: 'desc' }, { nextRunAt: 'asc' }],
    });
    return NextResponse.json({ rules });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireUser();
    await requireMembership(user.id, id);

    const input = createRecurringSchema.parse(await readJson(request));
    const rule = await createRecurring(id, user.id, input);
    // A rule starting today or earlier should produce its first expense now,
    // not leave the user wondering whether it saved.
    const created = await syncRecurring(id);
    return NextResponse.json({ rule, generated: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
