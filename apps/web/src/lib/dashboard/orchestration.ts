import 'server-only';

import { reconcileOpenClawSandboxLifecycle } from '@/lib/sandbox/openclaw';

export async function reconcileDashboardLifecycle() {
  return await reconcileOpenClawSandboxLifecycle();
}

