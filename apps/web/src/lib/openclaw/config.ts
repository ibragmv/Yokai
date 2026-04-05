import 'server-only';

import { OPENCLAW_PROVIDER_MODELS, resolveSupportedModelId } from '@/lib/models';
import type { DashboardSettings } from '@/lib/types';
import { splitCsv } from '@/lib/utils';

export function buildOpenClawConfig(settings: DashboardSettings): string {
  const allowedUsers = splitCsv(settings.allowedUserIds);
  const allowedGroups = splitCsv(settings.allowedGroupIds);
  const groups = Object.fromEntries(
    allowedGroups.map((groupId) => [
      groupId,
      {
        requireMention: settings.requireMention,
      },
    ]),
  );

  return JSON.stringify(
    {
      gateway: {
        mode: 'local',
        bind: 'lan',
        port: 18789,
        auth: {
          mode: 'token',
          token: '${OPENCLAW_GATEWAY_TOKEN}',
        },
      },
      agents: {
        defaults: {
          workspace: '/vercel/sandbox/openclaw/workspace',
          model: {
            primary: resolveSupportedModelId(settings.defaultModel),
          },
        },
      },
      models: {
        mode: 'merge',
        providers: {
          'vercel-ai-gateway': {
            baseUrl: 'https://ai-gateway.vercel.sh/v1',
            apiKey: '${AI_GATEWAY_API_KEY}',
            api: 'openai-completions',
            models: OPENCLAW_PROVIDER_MODELS,
          },
        },
      },
      channels: {
        telegram: {
          enabled: true,
          botToken: '${TELEGRAM_BOT_TOKEN}',
          dmPolicy: 'allowlist',
          allowFrom: allowedUsers,
          groupPolicy: 'allowlist',
          groups,
        },
      },
      session: {
        dmScope: 'per-channel-peer',
      },
    },
    null,
    2,
  );
}

export function sandboxEnvironment(settings: DashboardSettings): Record<string, string> {
  const env: Record<string, string> = {
    AI_GATEWAY_API_KEY: settings.aiGatewayApiKey,
    OPENCLAW_GATEWAY_TOKEN: settings.gatewayAuthToken,
    TELEGRAM_BOT_TOKEN: settings.telegramBotToken,
  };

  if (process.env.VERCEL_OIDC_TOKEN) {
    env.VERCEL_OIDC_TOKEN = process.env.VERCEL_OIDC_TOKEN;
  }

  return env;
}
