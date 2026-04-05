import 'server-only';

import { DEFAULT_MODELS, loadAvailableModels } from '@/lib/gateway/usage';
import { loadStoredSnapshot } from '@/lib/persistence/snapshots';
import { readDashboardState } from '@/lib/store';
import type { DashboardState } from '@/lib/store';
import type {
  DashboardOverviewPayload,
  DashboardPayload,
  DashboardPublicSettings,
  DashboardSettings,
} from '@/lib/types';
import { maskSecret } from '@/lib/utils';

function sanitizeSettings(settings: DashboardSettings): DashboardPublicSettings {
  return {
    ...settings,
    telegramBotToken: maskSecret(settings.telegramBotToken),
    aiGatewayApiKey: maskSecret(settings.aiGatewayApiKey),
    gatewayAuthToken: maskSecret(settings.gatewayAuthToken),
  };
}

function buildDashboardOverviewPayload(
  state: DashboardState,
  storedSnapshot: Awaited<ReturnType<typeof loadStoredSnapshot>>,
): DashboardOverviewPayload {
  return {
    settings: sanitizeSettings(state.settings),
    sandbox: state.sandbox,
    storedSnapshot,
    operationLease: state.operationLease,
    sessions: [...state.sessions].sort((left, right) => right.updatedAt - left.updatedAt),
    commands: [...state.commands].sort((left, right) => right.startedAt - left.startedAt),
    usage: [...state.usage].sort((left, right) => right.recordedAt - left.recordedAt),
  };
}

export async function loadDashboardOverviewPayload(): Promise<DashboardOverviewPayload> {
  const [state, storedSnapshot] = await Promise.all([
    readDashboardState(),
    loadStoredSnapshot().catch(() => null),
  ]);

  return buildDashboardOverviewPayload(state, storedSnapshot);
}

export async function loadDashboardPayload(): Promise<DashboardPayload> {
  const [state, storedSnapshot] = await Promise.all([
    readDashboardState(),
    loadStoredSnapshot().catch(() => null),
  ]);
  const availableModels = await loadAvailableModels(state.settings.aiGatewayApiKey || undefined)
    .catch(() => [])
    .then((models) => (models.length ? models : [...DEFAULT_MODELS]));

  return {
    ...buildDashboardOverviewPayload(state, storedSnapshot),
    availableModels,
  };
}
