import 'server-only';

import type { DashboardSettings } from '@/lib/types';

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectSecrets(settings: DashboardSettings): string[] {
  return [settings.telegramBotToken, settings.aiGatewayApiKey, settings.gatewayAuthToken].filter(
    Boolean,
  );
}

export function redactSecrets(value: string | null | undefined, settings: DashboardSettings) {
  if (!value) {
    return value ?? null;
  }

  return collectSecrets(settings).reduce((output, secret) => {
    return output.replace(new RegExp(escapeForRegExp(secret), 'g'), '[REDACTED]');
  }, value);
}

