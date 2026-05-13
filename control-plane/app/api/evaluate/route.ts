import { NextRequest, NextResponse } from 'next/server';
import { evaluateRisk } from '@/lib/engine';
import { EvaluateRequestSchema, EvaluateResponseBody } from '@/lib/types';
import { jsonError, getClientIp } from '@/lib/http';
import { checkRateLimit } from '@/lib/rate-limit';
import { logError, logInfo, logWarn } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const clientIp = getClientIp(req.headers);

  const limit = checkRateLimit(clientIp);
  if (!limit.allowed) {
    logWarn('rate_limited', { requestId, clientIp, retryAfterMs: limit.retryAfterMs });
    return jsonError(429, 'Too many requests.', { retryAfterMs: limit.retryAfterMs });
  }

  try {
    const rawBody = await req.json();
    const parsed = EvaluateRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      logWarn('invalid_request', { requestId, clientIp, issues: parsed.error.flatten() });
      return jsonError(400, 'Invalid request body.', { issues: parsed.error.flatten() });
    }

    const body = parsed.data;
    const start = Date.now();
    const result = evaluateRisk(body.request);
    const durationMs = Date.now() - start;
    
    // Log to DB (lazy import to avoid build-time connection)
    try {
      const { getPrisma } = await import('@/lib/prisma');
      const prisma = getPrisma();
      await prisma.evaluation.create({
        data: {
          scenario: body.scenario || 'Custom',
          ip: body.request.ip,
          location: body.request.location.label,
          userAgent: body.request.userAgent,
          riskScore: result.riskScore,
          action: result.action,
          durationMs,
          reasoning: result.reasoning,
        },
      });
    } catch (dbErr) {
      logWarn('db_write_skipped', { requestId, clientIp, error: String(dbErr) });
    }

    const response: EvaluateResponseBody = { result, durationMs };
    logInfo('evaluation_complete', {
      requestId,
      clientIp,
      riskScore: result.riskScore,
      action: result.action,
      durationMs,
    });
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    logError('evaluation_error', { requestId, clientIp, error: String(err) });
    return jsonError(500, 'Evaluation failed.');
  }
}
