import 'server-only';

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ForbiddenError, UnauthorizedError } from './auth';
import { ServiceError } from './groups';
import { SplitError } from './split/allocate';

/**
 * One place that turns a thrown error into an HTTP response, so every route
 * handler can just throw and stay readable.
 *
 * Unknown errors deliberately return a generic message: an internal stack
 * trace or a Prisma error string leaks schema details to the client.
 */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: err.issues[0]?.message ?? 'That input is not valid',
        fields: Object.fromEntries(
          err.issues.map((i) => [i.path.join('.') || '_', i.message]),
        ),
      },
      { status: 422 },
    );
  }
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof ServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof SplitError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  console.error('[splitsmart] unhandled error:', err);
  return NextResponse.json({ error: 'Something went wrong on our end' }, { status: 500 });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ServiceError('The request body was not valid JSON');
  }
}
