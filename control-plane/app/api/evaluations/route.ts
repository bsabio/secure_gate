import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { getPrisma } = await import('@/lib/prisma');
    const prisma = getPrisma();
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
