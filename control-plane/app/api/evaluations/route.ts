import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const evaluations = await prisma.evaluation.findMany({
      orderBy: { ts: 'desc' },
      take: 50,
    });
    return NextResponse.json(evaluations, { status: 200 });
  } catch (err) {
    console.error('[secure-gate] error fetching evaluations:', err);
    return NextResponse.json({ error: 'Failed to fetch evaluations.' }, { status: 500 });
  }
}
