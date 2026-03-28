import { NextResponse } from 'next/server';

import { loadDashboardPayload } from '@/lib/dashboard/data';

export async function GET() {
  const payload = await loadDashboardPayload();
  return NextResponse.json(payload);
}
