import { NextRequest, NextResponse } from 'next/server';
import { evaluateRisk } from '@/lib/engine';
import { EvaluateRequestBody, EvaluateResponseBody } from '@/lib/types';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body: EvaluateRequestBody = await req.json();
    const start = Date.now();
    const result = evaluateRisk(body.request);
    const durationMs = Date.now() - start;
    
    // Log to DB
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

    const response: EvaluateResponseBody = { result, durationMs };
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error('[secure-gate] evaluation error:', err);
    return NextResponse.json({ error: 'Evaluation failed.' }, { status: 500 });
  }
}
