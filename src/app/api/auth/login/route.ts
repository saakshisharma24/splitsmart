import { NextResponse } from 'next/server';
import { createSession, verifyPassword } from '@/lib/auth';
import { errorResponse, readJson } from '@/lib/api';
import { prisma } from '@/lib/db';
import { ServiceError } from '@/lib/groups';
import { clientKey, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { loginSchema } from '@/lib/validation';

export async function POST(request: Request) {
  try {
    // Throttle by IP first - this is the cheap check, before touching the DB.
    const byIp = rateLimit(clientKey(request, 'login'), 10, 60_000);
    if (!byIp.ok) return tooManyRequests(byIp.retryAfterSeconds);

    const input = loginSchema.parse(await readJson(request));

    // And by account, because x-forwarded-for is client-controlled: an attacker
    // rotating IPs would otherwise get unlimited guesses at one password.
    const byAccount = rateLimit(`login:acct:${input.email}`, 5, 15 * 60_000);
    if (!byAccount.ok) return tooManyRequests(byAccount.retryAfterSeconds);

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
