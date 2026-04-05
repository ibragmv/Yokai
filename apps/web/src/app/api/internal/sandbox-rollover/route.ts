import { after } from 'next/server';
import type { NextRequest } from 'next/server';

import { reconcileDashboardLifecycle } from '@/lib/dashboard/orchestration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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

  const shouldWait = request.nextUrl.searchParams.get('wait') === '1';

  if (shouldWait) {
    const result = await reconcileDashboardLifecycle();

    return Response.json(
      {
        ok: true,
        mode: 'sync',
        result,
      },
      {
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
        },
      },
    );
  }

  after(async () => {
    try {
      await reconcileDashboardLifecycle();
    } catch (error) {
      console.error('Sandbox rollover failed.', error);
    }
  });

  return Response.json(
    {
      ok: true,
      mode: 'async',
      message: 'Sandbox rollover scheduled.',
    },
    {
      status: 202,
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    },
  );
}
