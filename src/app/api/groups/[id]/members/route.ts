import { NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse, readJson } from '@/lib/api';
import { requireMembership, requireUser } from '@/lib/auth';
import { addMemberByEmail } from '@/lib/groups';

const schema = z.object({ email: z.string().trim().toLowerCase().email() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireUser();
    await requireMembership(user.id, id);

    const { email } = schema.parse(await readJson(request));
    await addMemberByEmail(id, user.id, email);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
