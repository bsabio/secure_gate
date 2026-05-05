import { NextRequest, NextResponse } from 'next/server';
import { evaluateRisk } from '@/lib/engine';
import { EvaluateRequestBody, EvaluateResponseBody } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body: EvaluateRequestBody = await req.json();
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
      console.warn('[secure-gate] DB write skipped:', dbErr);
    }

    const response: EvaluateResponseBody = { result, durationMs };
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error('[secure-gate] evaluation error:', err);
    return NextResponse.json({ error: 'Evaluation failed.' }, { status: 500 });
  }
}
