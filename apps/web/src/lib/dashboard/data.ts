import 'server-only';

import { loadAvailableModels } from '@/lib/gateway/usage';
import { reconcileOpenClawSandboxLifecycle } from '@/lib/sandbox/openclaw';
import { readDashboardState } from '@/lib/store';
import type { DashboardPayload, DashboardPublicSettings, DashboardSettings } from '@/lib/types';
import { maskSecret } from '@/lib/utils';

const DEFAULT_MODELS = [
  'vercel-ai-gateway/anthropic/claude-sonnet-4.6',
  'vercel-ai-gateway/google/gemini-3-flash',
] as const;

function sanitizeSettings(settings: DashboardSettings): DashboardPublicSettings {
  return {
    ...settings,
    telegramBotToken: maskSecret(settings.telegramBotToken),
    aiGatewayApiKey: maskSecret(settings.aiGatewayApiKey),
    vercelApiToken: maskSecret(settings.vercelApiToken),
    persistenceDatabaseUrl: maskSecret(settings.persistenceDatabaseUrl),
    gatewayAuthToken: maskSecret(settings.gatewayAuthToken),
  };
}

export async function loadDashboardPayload(): Promise<DashboardPayload> {
  await reconcileOpenClawSandboxLifecycle().catch(() => {});
  const state = await readDashboardState();
  const availableModels = await loadAvailableModels(state.settings.aiGatewayApiKey || undefined)
    .catch(() => [])
    .then((models) => (models.length ? models : [...DEFAULT_MODELS]));

  return {
    settings: sanitizeSettings(state.settings),
    sandbox: state.sandbox,
    sessions: [...state.sessions].sort((left, right) => right.updatedAt - left.updatedAt),
    commands: [...state.commands].sort((left, right) => right.startedAt - left.startedAt),
    usage: [...state.usage].sort((left, right) => right.recordedAt - left.recordedAt),
    availableModels,
  };
}
