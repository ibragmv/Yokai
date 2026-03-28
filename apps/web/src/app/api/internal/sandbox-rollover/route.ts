import type { NextRequest } from 'next/server';

import { reconcileOpenClawSandboxLifecycle } from '@/lib/sandbox/openclaw';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest) {
  if (process.env.NODE_ENV !== 'production' && !process.env.CRON_SECRET) {
    return true;
  }

  return Boolean(
    process.env.CRON_SECRET &&
      request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`,
  );
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json(
      {
        ok: false,
        message: 'Unauthorized',
      },
      {
        status: 401,
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
        },
      },
    );
  }

  const result = await reconcileOpenClawSandboxLifecycle();

  return Response.json(
    {
      ok: true,
      result,
    },
    {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    },
  );
}
