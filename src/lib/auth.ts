import 'server-only';

import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { prisma } from './db';

/**
 * Session auth: bcrypt password hashes, a signed JWT in an httpOnly cookie.
 *
 * No auth provider and no external service, so the project clones and runs
 * offline. The cookie is httpOnly and sameSite=lax, which is what actually
 * matters here - a token in localStorage is readable by any script that gets
 * onto the page.
 */

const COOKIE = 'splitsmart_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secret(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error(
      'AUTH_SECRET is missing or too short. Copy .env.example to .env and set it ' +
        '(node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))").',
    );
  }
  return new TextEncoder().encode(raw);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function createSession(userId: string): Promise<void> {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  upiId: string | null;
}

/** The signed-in user, or null. Never throws - callers decide what to do. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret());
    const id = typeof payload.sub === 'string' ? payload.sub : null;
    if (!id) return null;

    return await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, avatarColor: true, upiId: true },
    });
  } catch {
    // Expired, tampered with, or signed by an older AUTH_SECRET.
    return null;
  }
}

/** For routes that cannot run without a user. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super('You need to be signed in to do that');
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'You do not have access to that') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/** Throws unless the user is a member of the group. Used by every group route. */
export async function requireMembership(userId: string, groupId: string): Promise<void> {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { id: true },
  });
  if (!membership) throw new ForbiddenError('You are not a member of this group');
}

/** Stable, pleasant avatar colour derived from the user's name. */
export function avatarColorFor(seed: string): string {
  const palette = [
    '#10b981', '#6366f1', '#f97316', '#ec4899', '#06b6d4',
    '#eab308', '#a855f7', '#ef4444', '#14b8a6', '#8b5cf6',
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}
