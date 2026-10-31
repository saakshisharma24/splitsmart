import { NextResponse } from 'next/server';
import { errorResponse, readJson } from '@/lib/api';
import { requireMembership, requireUser } from '@/lib/auth';
import { recordSettlement } from '@/lib/groups';
import { settleSchema } from '@/lib/validation';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireUser();
    await requireMembership(user.id, id);

    const input = settleSchema.parse(await readJson(request));
    const settlement = await recordSettlement(id, user.id, input);
    return NextResponse.json({ settlement }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
