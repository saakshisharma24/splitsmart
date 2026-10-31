import { NextResponse } from 'next/server';
import { createSession, verifyPassword } from '@/lib/auth';
import { errorResponse, readJson } from '@/lib/api';
import { prisma } from '@/lib/db';
import { ServiceError } from '@/lib/groups';
import { loginSchema } from '@/lib/validation';

export async function POST(request: Request) {
  try {
    const input = loginSchema.parse(await readJson(request));
    const user = await prisma.user.findUnique({ where: { email: input.email } });

    // Same message and roughly the same work either way, so the response does
    // not reveal whether an account exists.
    const ok = user ? await verifyPassword(input.password, user.passwordHash) : false;
    if (!user || !ok) throw new ServiceError('That email and password do not match', 401);

    await createSession(user.id);
    return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    return errorResponse(err);
  }
}
