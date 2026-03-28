import { loadAvailableModels } from '@/lib/gateway/usage';
import { readDashboardState } from '@/lib/store';
import type { DashboardPayload, DashboardSettings } from '@/lib/types';
import { maskSecret } from '@/lib/utils';

function sanitizeSettings(settings: DashboardSettings): DashboardSettings {
  return {
    ...settings,
    telegramBotToken: maskSecret(settings.telegramBotToken),
    aiGatewayApiKey: maskSecret(settings.aiGatewayApiKey),
    vercelApiToken: maskSecret(settings.vercelApiToken),
  };
}

export async function loadDashboardPayload(): Promise<DashboardPayload> {
  const state = await readDashboardState();
  const availableModels = await loadAvailableModels(state.settings.aiGatewayApiKey || undefined)
    .catch(() => [])
    .then((models) =>
      models.length
        ? models
        : [
            'vercel-ai-gateway/anthropic/claude-sonnet-4.6',
            'vercel-ai-gateway/google/gemini-3-flash',
          ],
    );

  return {
    settings: sanitizeSettings(state.settings),
    sandbox: state.sandbox,
    sessions: [...state.sessions].sort((left, right) => right.updatedAt - left.updatedAt),
    commands: [...state.commands].sort((left, right) => right.startedAt - left.startedAt),
    usage: [...state.usage].sort((left, right) => right.recordedAt - left.recordedAt),
    availableModels,
  };
}
