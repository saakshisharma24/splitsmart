import { NextResponse } from 'next/server';
import { errorResponse, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { createGroup, listGroupsForUser } from '@/lib/groups';
import { createGroupSchema } from '@/lib/validation';

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ groups: await listGroupsForUser(user.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = createGroupSchema.parse(await readJson(request));
    const { group, unknownEmails } = await createGroup(user.id, input);
    // 201 even with unknown emails - the group was created; the caller decides
    // how to surface the ones that could not be added.
    return NextResponse.json({ group, unknownEmails }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
