import 'server-only';

import { DEFAULT_MODELS, loadAvailableModels } from '@/lib/gateway/usage';
import { loadStoredSnapshot } from '@/lib/persistence/snapshots';
import { reconcileOpenClawSandboxLifecycle } from '@/lib/sandbox/openclaw';
import { readDashboardState } from '@/lib/store';
import type { DashboardPayload, DashboardPublicSettings, DashboardSettings } from '@/lib/types';
import { maskSecret } from '@/lib/utils';

function sanitizeSettings(settings: DashboardSettings): DashboardPublicSettings {
  return {
    ...settings,
    telegramBotToken: maskSecret(settings.telegramBotToken),
    aiGatewayApiKey: maskSecret(settings.aiGatewayApiKey),
    vercelApiToken: maskSecret(settings.vercelApiToken),
    gatewayAuthToken: maskSecret(settings.gatewayAuthToken),
  };
}

export async function loadDashboardPayload(): Promise<DashboardPayload> {
  await reconcileOpenClawSandboxLifecycle().catch(() => {});
  const state = await readDashboardState();
  const [storedSnapshot, availableModels] = await Promise.all([
    loadStoredSnapshot().catch(() => null),
    loadAvailableModels(state.settings.aiGatewayApiKey || undefined)
      .catch(() => [])
      .then((models) => (models.length ? models : [...DEFAULT_MODELS])),
  ]);

  return {
    settings: sanitizeSettings(state.settings),
    sandbox: state.sandbox,
    storedSnapshot,
    operationLease: state.operationLease,
    sessions: [...state.sessions].sort((left, right) => right.updatedAt - left.updatedAt),
    commands: [...state.commands].sort((left, right) => right.startedAt - left.startedAt),
    usage: [...state.usage].sort((left, right) => right.recordedAt - left.recordedAt),
    availableModels,
  };
}
