import { DashboardShell } from '@/components/dashboard-shell';
import { loadDashboardPayload } from '@/lib/dashboard/data';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const data = await loadDashboardPayload();

  return <DashboardShell initialData={data} />;
}
