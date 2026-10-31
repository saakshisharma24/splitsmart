import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { requireMembership, requireUser } from '@/lib/auth';
import { getGroupState } from '@/lib/groups';
import { buildCsv, buildWorkbook } from '@/lib/export/workbook';

/** GET /api/groups/:id/export?format=xlsx|csv */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireUser();
    await requireMembership(user.id, id);

    const format = new URL(request.url).searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
    const state = await getGroupState(id, user.id);

    const input = {
      groupName: state.group.name,
      currency: state.group.currency,
      members: state.members.map((m) => ({ id: m.id, name: m.name })),
      expenses: state.expenses,
      analytics: state.analytics,
      settleUp: state.settleUp,
      settlements: state.settlements.map((s) => ({
        from: s.from, to: s.to, amountMinor: s.amountMinor, settledAt: s.settledAt, method: s.method,
      })),
    };

    // Safe for a Content-Disposition header and for a filesystem.
    const slug = state.group.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'group';
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      return new NextResponse(buildCsv(input), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${slug}-${stamp}.csv"`,
        },
      });
    }

    const buffer = await buildWorkbook(input);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${slug}-${stamp}.xlsx"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
