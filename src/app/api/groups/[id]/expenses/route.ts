import { NextResponse } from 'next/server';
import { errorResponse, readJson } from '@/lib/api';
import { requireMembership, requireUser } from '@/lib/auth';
import { createExpense } from '@/lib/groups';
import { createExpenseSchema } from '@/lib/validation';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireUser();
    await requireMembership(user.id, id);

    const input = createExpenseSchema.parse(await readJson(request));
    const expense = await createExpense(id, user.id, input);
    return NextResponse.json({ expense }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
