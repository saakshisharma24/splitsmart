import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { requireMembership, requireUser } from '@/lib/auth';
import { deleteExpense } from '@/lib/groups';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; expenseId: string }> },
) {
  try {
    const { id, expenseId } = await params;
    const user = await requireUser();
    await requireMembership(user.id, id);
    await deleteExpense(id, expenseId, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
