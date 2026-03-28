'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { requireAdminSession } from '@/lib/auth/session';
import { loadDashboardPayload } from '@/lib/dashboard/data';
import { fetchGatewayCredits } from '@/lib/gateway/usage';
import {
  createOpenClawSandbox,
  snapshotOpenClawSandbox,
  stopOpenClawSandbox,
  syncOpenClawSessions,
} from '@/lib/sandbox/openclaw';
import { redactSecrets } from '@/lib/security/redaction';
import { appendCommand, appendUsage, readDashboardState, updateDashboardState } from '@/lib/store';
import type { DashboardActionResult, SettingsFormValues } from '@/lib/types';

type SandboxAction = 'start' | 'stop' | 'sync';

function keepSecret(nextValue: string, currentValue: string): string {
  if (!nextValue || nextValue.includes('••••')) {
    return currentValue;
  }

  return nextValue;
}

async function getResult(ok: boolean, message: string): Promise<DashboardActionResult> {
  revalidatePath('/');

  return {
    ok,
    message,
    payload: await loadDashboardPayload(),
  };
}

function sanitizeActionError(error: unknown, settings: Parameters<typeof redactSecrets>[1]) {
  return redactSecrets(error instanceof Error ? error.message : 'Unknown sandbox error', settings);
}

async function recordGatewayCredits() {
  const state = await readDashboardState();

  try {
    const credits = await fetchGatewayCredits(state.settings.aiGatewayApiKey || undefined);
    if (!credits) {
      return;
    }

    await updateDashboardState((current) => ({
      ...current,
      usage: appendUsage(current.usage, {
        source: 'ai-gateway',
        creditsRemaining:
          typeof credits.remainingCredits === 'number' ? credits.remainingCredits : null,
        creditsUsed: typeof credits.usedCredits === 'number' ? credits.usedCredits : null,
        cpuMs: null,
        networkBytes: null,
        recordedAt: Date.now(),
      }),
    }));
  } catch {}
}

export async function saveSettingsAction(
  input: SettingsFormValues,
): Promise<DashboardActionResult> {
  await requireAdminSession();
  const current = await readDashboardState();

  await updateDashboardState((state) => ({
    ...state,
    settings: {
      ...state.settings,
      displayName: input.displayName,
      telegramBotToken: keepSecret(input.telegramBotToken, current.settings.telegramBotToken),
      aiGatewayApiKey: keepSecret(input.aiGatewayApiKey, current.settings.aiGatewayApiKey),
      vercelApiToken: keepSecret(input.vercelApiToken, current.settings.vercelApiToken),
      persistenceDatabaseUrl: keepSecret(
        input.persistenceDatabaseUrl,
        current.settings.persistenceDatabaseUrl,
      ),
      vercelProjectId: input.vercelProjectId,
      vercelTeamId: input.vercelTeamId,
      allowedUserIds: input.allowedUserIds,
      allowedGroupIds: input.allowedGroupIds,
      requireMention: input.requireMention,
      autoRecreateSandbox: input.autoRecreateSandbox,
      timeoutSeconds: input.timeoutSeconds,
      defaultModel: input.defaultModel,
      gatewayAuthToken: state.settings.gatewayAuthToken || randomUUID(),
      updatedAt: Date.now(),
    },
  }));

  await recordGatewayCredits();
  return getResult(true, 'Settings saved.');
}

export async function runSandboxAction(action: SandboxAction): Promise<DashboardActionResult> {
  await requireAdminSession();
  const state = await readDashboardState();

  if (action === 'start' && state.sandbox?.status === 'running') {
    return getResult(true, 'Sandbox is already running.');
  }

  if (!state.sandbox && action !== 'start') {
    return getResult(false, 'There is no sandbox to manage yet.');
  }

  try {
    if (action === 'start') {
      const { sandboxRecord, commands } = await createOpenClawSandbox(state.settings);
      await updateDashboardState((current) => ({
        ...current,
        sandbox: sandboxRecord,
        sessions: [],
        commands: commands.reduce(
          (items, command) => appendCommand(items, command),
          current.commands,
        ),
      }));
    }

    if (action === 'stop' && state.sandbox) {
      const snapshotCommand = await snapshotOpenClawSandbox(
        state.sandbox.sandboxId,
        state.settings,
      );
      if (!snapshotCommand) {
        await stopOpenClawSandbox(state.sandbox.sandboxId);
      }
      await updateDashboardState((current) => ({
        ...current,
        commands: snapshotCommand
          ? appendCommand(current.commands, snapshotCommand)
          : current.commands,
        sandbox: current.sandbox
          ? {
              ...current.sandbox,
              status: 'stopped',
              errorMessage: null,
              lastSnapshotAt: snapshotCommand?.finishedAt ?? current.sandbox.lastSnapshotAt,
              updatedAt: Date.now(),
            }
          : null,
      }));
    }

    if (action === 'sync' && state.sandbox) {
      const synced = await syncOpenClawSessions(state.sandbox.sandboxId, state.settings);
      await updateDashboardState((current) => ({
        ...current,
        sandbox: synced.sandbox,
        sessions: synced.sessions,
        commands: synced.commands.reduce(
          (commands, command) => appendCommand(commands, command),
          current.commands,
        ),
        usage: appendUsage(current.usage, {
          source: 'sandbox',
          creditsRemaining: null,
          creditsUsed: null,
          cpuMs: synced.sandbox.activeCpuUsageMs,
          networkBytes: synced.sandbox.networkBytes,
          recordedAt: Date.now(),
        }),
      }));
    }

    await recordGatewayCredits();

    const message =
      action === 'start'
        ? 'Sandbox started.'
        : action === 'stop'
          ? 'Sandbox stopped.'
          : 'Sandbox state synced.';

    return getResult(true, message);
  } catch (error) {
    const message = sanitizeActionError(error, state.settings) ?? 'Sandbox action failed.';

    await updateDashboardState((current) => ({
      ...current,
      sandbox: current.sandbox
        ? {
            ...current.sandbox,
            status: 'error',
            errorMessage: message,
            updatedAt: Date.now(),
          }
        : null,
    }));

    return getResult(false, message);
  }
}
