import { readAdminSession } from '@/lib/auth/session';
import { loadDashboardPayload } from '@/lib/dashboard/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await readAdminSession();
  if (!session) {
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

  return Response.json(await loadDashboardPayload(), {
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
    },
  });
}
