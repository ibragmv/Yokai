import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import { api, getConvexClient } from '@/lib/convex/server';
import { loadDashboardPayload } from '@/lib/dashboard/data';

type SettingsInput = {
  displayName: string;
  telegramBotToken: string;
  aiGatewayApiKey: string;
  vercelApiToken: string;
  vercelProjectId: string;
  vercelTeamId: string;
  allowedUserIds: string;
  allowedGroupIds: string;
  requireMention: boolean;
  timeoutSeconds: number;
  defaultModel: string;
};

function keepSecret(nextValue: string, currentValue: string): string {
  if (!nextValue || nextValue.includes('••••')) {
    return currentValue;
  }

  return nextValue;
}

export async function POST(request: Request) {
  const body = (await request.json()) as SettingsInput;
  const client = getConvexClient();
  const current = await client.query(api.settings.get, {});

  await client.mutation(api.settings.upsert, {
    displayName: body.displayName,
    telegramBotToken: keepSecret(body.telegramBotToken, current.telegramBotToken),
    aiGatewayApiKey: keepSecret(body.aiGatewayApiKey, current.aiGatewayApiKey),
    vercelApiToken: keepSecret(body.vercelApiToken, current.vercelApiToken),
    vercelProjectId: body.vercelProjectId,
    vercelTeamId: body.vercelTeamId,
    allowedUserIds: body.allowedUserIds,
    allowedGroupIds: body.allowedGroupIds,
    requireMention: body.requireMention,
    timeoutSeconds: body.timeoutSeconds,
    defaultModel: body.defaultModel,
    gatewayAuthToken: current.gatewayAuthToken || randomUUID(),
  });

  const payload = await loadDashboardPayload();
  return NextResponse.json(payload);
}
