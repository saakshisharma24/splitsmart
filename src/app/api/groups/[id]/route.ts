import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { requireMembership, requireUser } from '@/lib/auth';
import { getGroupState, syncRecurring } from '@/lib/groups';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireUser();
    await requireMembership(user.id, id);

    // Fire any recurring expenses that came due while nobody was looking.
    await syncRecurring(id);

    return NextResponse.json(await getGroupState(id, user.id));
  } catch (err) {
    return errorResponse(err);
  }
}
