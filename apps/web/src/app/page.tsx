import { DashboardShell } from '@/components/dashboard-shell';
import { requireAdminSession } from '@/lib/auth/session';
import { loadDashboardPayload } from '@/lib/dashboard/data';
import { reconcileDashboardLifecycle } from '@/lib/dashboard/orchestration';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  await requireAdminSession();
  await reconcileDashboardLifecycle().catch(() => {});
  const data = await loadDashboardPayload();

  return <DashboardShell initialData={data} />;
}
