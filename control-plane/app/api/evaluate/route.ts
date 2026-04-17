import { NextRequest, NextResponse } from 'next/server';
import { evaluateRisk } from '@/lib/engine';
import { EvaluateRequestBody, EvaluateResponseBody } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body: EvaluateRequestBody = await req.json();
    const start = Date.now();
    const result = evaluateRisk(body.request);
    const durationMs = Date.now() - start;
    const response: EvaluateResponseBody = { result, durationMs };
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error('[secure-gate] evaluation error:', err);
    return NextResponse.json({ error: 'Evaluation failed.' }, { status: 500 });
  }
}
