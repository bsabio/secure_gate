import { NextRequest, NextResponse } from 'next/server';
import { jsonError } from '@/lib/http';
import { logError, logInfo, logWarn } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 50;
  if (Number.isNaN(limit) || limit <= 0 || limit > 200) {
    logWarn('invalid_limit', { requestId, limitParam });
    return jsonError(400, 'Invalid limit. Use 1-200.');
  }

  try {
    const { getPrisma } = await import('@/lib/prisma');
    const prisma = getPrisma();
    const evaluations = await prisma.evaluation.findMany({
      orderBy: { ts: 'desc' },
      take: limit,
    });
    logInfo('evaluations_listed', { requestId, count: evaluations.length });
    return NextResponse.json(evaluations, { status: 200 });
  } catch (err) {
    logError('evaluations_fetch_error', { requestId, error: String(err) });
    return jsonError(500, 'Failed to fetch evaluations.');
  }
}
