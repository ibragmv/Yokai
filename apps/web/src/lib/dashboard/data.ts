import { api, getConvexClient } from '@/lib/convex/server';
import { loadAvailableModels } from '@/lib/gateway/usage';
import type { DashboardPayload } from '@/lib/types';

export async function loadDashboardPayload(): Promise<DashboardPayload> {
  const client = getConvexClient();
  const settings = await client.query(api.settings.get, {});
  const sandbox = await client.query(api.sandboxes.getCurrent, {});
  const sessions = sandbox
    ? await client.query(api.sessions.listBySandbox, { sandboxId: sandbox.sandboxId })
    : [];
  const commands = await client.query(api.telemetry.listRecentCommands, {});
  const usage = await client.query(api.telemetry.listRecentUsage, {});
  const availableModels = await loadAvailableModels(settings.aiGatewayApiKey || undefined);

  return {
    settings: {
      ...settings,
      telegramBotToken: '',
      aiGatewayApiKey: '',
      vercelApiToken: '',
      gatewayAuthToken: '',
    },
    sandbox,
    sessions,
    commands,
    usage,
    availableModels,
  };
}
