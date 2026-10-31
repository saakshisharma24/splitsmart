import { NextResponse } from 'next/server';
import { avatarColorFor, createSession, hashPassword } from '@/lib/auth';
import { errorResponse, readJson } from '@/lib/api';
import { prisma } from '@/lib/db';
import { ServiceError } from '@/lib/groups';
import { signupSchema } from '@/lib/validation';

export async function POST(request: Request) {
  try {
    const input = signupSchema.parse(await readJson(request));

    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ServiceError('An account with that email already exists', 409);

    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        avatarColor: avatarColorFor(input.name),
        upiId: input.upiId || null,
      },
      select: { id: true, name: true, email: true },
    });

    await createSession(user.id);
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
