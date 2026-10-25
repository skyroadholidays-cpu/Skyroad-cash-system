import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/session';
import { runReport, REPORTS, type ReportKey } from '@/lib/insights';
import { reportToCsv } from '@/lib/csv';
import { todayIST } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const key = (Object.keys(REPORTS).includes(p.get('r') ?? '') ? p.get('r') : 'register') as ReportKey;
  const today = todayIST();
  const report = await runReport(key, {
    from: p.get('from') ?? today.slice(0, 8) + '01',
    to: p.get('to') ?? today,
    type: p.get('type'),
    location_id: Number(p.get('location')) || null,
    q: p.get('q'),
    scope: p.get('scope'),
  }, today);
  const name = `skyroad-${key}-${today}.csv`;
  return new NextResponse(reportToCsv(report), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
