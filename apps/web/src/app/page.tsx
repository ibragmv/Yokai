import { DashboardShell } from '@/components/dashboard-shell';
import { requireAdminSession } from '@/lib/auth/session';
import { loadDashboardPayload } from '@/lib/dashboard/data';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  await requireAdminSession();
  const data = await loadDashboardPayload();

  return <DashboardShell initialData={data} />;
}
