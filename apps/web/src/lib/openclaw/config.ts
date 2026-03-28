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
          token: settings.gatewayAuthToken,
        },
      },
      agents: {
        defaults: {
          workspace: '/vercel/sandbox/openclaw/workspace',
          model: {
            primary: settings.defaultModel,
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
            models: [
              {
                id: 'google/gemini-3-flash',
                name: 'Gemini 3 Flash',
                reasoning: false,
                input: ['text'],
                contextWindow: 1000000,
                maxTokens: 8192,
                cost: {
                  input: 0.5,
                  output: 3,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
              },
            ],
          },
        },
      },
      channels: {
        telegram: {
          enabled: true,
          botToken: settings.telegramBotToken,
          dmPolicy: 'allowlist',
          allowFrom: allowedUsers,
          groupPolicy: 'allowlist',
          groupAllowFrom: allowedUsers,
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
  };

  if (process.env.VERCEL_OIDC_TOKEN) {
    env.VERCEL_OIDC_TOKEN = process.env.VERCEL_OIDC_TOKEN;
  }

  const vercelAccessToken = settings.vercelApiToken || process.env.VERCEL_ACCESS_TOKEN;
  const vercelProjectId = settings.vercelProjectId || process.env.VERCEL_PROJECT_ID;
  const vercelTeamId = settings.vercelTeamId || process.env.VERCEL_TEAM_ID;

  if (vercelAccessToken) {
    env.VERCEL_ACCESS_TOKEN = vercelAccessToken;
  }

  if (vercelProjectId) {
    env.VERCEL_PROJECT_ID = vercelProjectId;
  }

  if (vercelTeamId) {
    env.VERCEL_TEAM_ID = vercelTeamId;
  }

  return env;
}
