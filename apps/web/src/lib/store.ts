import 'server-only';

import { randomUUID } from 'node:crypto';

import { fetchMutation, fetchQuery } from 'convex/nextjs';

import { decryptValue, encryptValue } from '@/lib/security/crypto';
import type {
  CommandRecord,
  DashboardSettings,
  SandboxRecord,
  SessionRecord,
  UsageSnapshot,
} from '@/lib/types';
import { resolveVercelProjectId, resolveVercelTeamId } from '@/lib/vercel/project';
import { api } from '@convex/_generated/api';

export type DashboardState = {
  settings: DashboardSettings;
  sandbox: SandboxRecord | null;
  sessions: SessionRecord[];
  commands: CommandRecord[];
  usage: UsageSnapshot[];
};

const STATE_KEY = 'primary';

let writeQueue = Promise.resolve();

const SECRET_SETTING_KEYS = [
  'telegramBotToken',
  'aiGatewayApiKey',
  'vercelApiToken',
  'gatewayAuthToken',
  'persistenceDatabaseUrl',
] as const;

type SecretSettingKey = (typeof SECRET_SETTING_KEYS)[number];
type EncryptedField = Awaited<ReturnType<typeof encryptValue>>;

type PersistedDashboardState = {
  settings: Omit<DashboardSettings, SecretSettingKey>;
  encryptedSettings: Record<SecretSettingKey, EncryptedField>;
  sandbox: SandboxRecord | null;
  sessions: SessionRecord[];
  commands: CommandRecord[];
  usage: UsageSnapshot[];
};

type LegacyPersistedDashboardState = Omit<PersistedDashboardState, 'encryptedSettings'> & {
  encryptedSettings?: Partial<Record<SecretSettingKey, EncryptedField>>;
};

function isEncryptionAuthError(error: unknown) {
  return (
    error instanceof Error && error.message === 'Unsupported state or unable to authenticate data'
  );
}

function isEncryptedField(value: unknown): value is EncryptedField {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'iv' in value &&
      typeof value.iv === 'string' &&
      'tag' in value &&
      typeof value.tag === 'string' &&
      'value' in value &&
      typeof value.value === 'string',
  );
}

function createDefaultState(): DashboardState {
  return {
    settings: {
      displayName: 'Yokai Control Room',
      telegramBotToken: '',
      aiGatewayApiKey: process.env.AI_GATEWAY_API_KEY ?? '',
      vercelApiToken: process.env.VERCEL_ACCESS_TOKEN ?? '',
      persistenceDatabaseUrl: process.env.OPENCLAW_PERSISTENCE_DATABASE_URL ?? '',
      vercelProjectId: resolveVercelProjectId(),
      vercelTeamId: resolveVercelTeamId(),
      allowedUserIds: '',
      allowedGroupIds: '',
      requireMention: true,
      autoRecreateSandbox: Boolean(process.env.OPENCLAW_PERSISTENCE_DATABASE_URL),
      timeoutSeconds: 900,
      defaultModel: 'vercel-ai-gateway/anthropic/claude-sonnet-4.6',
      gatewayAuthToken: randomUUID(),
      updatedAt: null,
    },
    sandbox: null,
    sessions: [],
    commands: [],
    usage: [],
  };
}

function splitSettings(settings: DashboardSettings) {
  return {
    plainSettings: {
      displayName: settings.displayName,
      vercelProjectId: settings.vercelProjectId,
      vercelTeamId: settings.vercelTeamId,
      allowedUserIds: settings.allowedUserIds,
      allowedGroupIds: settings.allowedGroupIds,
      requireMention: settings.requireMention,
      autoRecreateSandbox: settings.autoRecreateSandbox,
      timeoutSeconds: settings.timeoutSeconds,
      defaultModel: settings.defaultModel,
      updatedAt: settings.updatedAt,
    },
    secretSettings: {
      telegramBotToken: settings.telegramBotToken,
      aiGatewayApiKey: settings.aiGatewayApiKey,
      vercelApiToken: settings.vercelApiToken,
      gatewayAuthToken: settings.gatewayAuthToken,
      persistenceDatabaseUrl: settings.persistenceDatabaseUrl,
    },
  };
}

async function serializeState(state: DashboardState): Promise<PersistedDashboardState> {
  const { plainSettings, secretSettings } = splitSettings(state.settings);
  const encryptedSettings = Object.fromEntries(
    await Promise.all(
      SECRET_SETTING_KEYS.map(
        async (key) => [key, await encryptValue(secretSettings[key])] as const,
      ),
    ),
  ) as Record<SecretSettingKey, EncryptedField>;

  return {
    settings: plainSettings,
    encryptedSettings,
    sandbox: state.sandbox,
    sessions: state.sessions,
    commands: state.commands,
    usage: state.usage,
  };
}

async function deserializeState(payload: LegacyPersistedDashboardState): Promise<DashboardState> {
  const fallback = createDefaultState();
  const decryptedEntries = await Promise.all(
    SECRET_SETTING_KEYS.map(async (key) => {
      const encryptedValue = payload.encryptedSettings?.[key];
      if (!isEncryptedField(encryptedValue)) {
        return [key, fallback.settings[key]] as const;
      }

      return [key, await decryptValue(encryptedValue)] as const;
    }),
  );
  const decryptedSettings = Object.fromEntries(decryptedEntries) as Record<
    SecretSettingKey,
    string
  >;

  return normalizeState({
    settings: {
      ...payload.settings,
      ...decryptedSettings,
    },
    sandbox: payload.sandbox,
    sessions: payload.sessions,
    commands: payload.commands,
    usage: payload.usage,
  });
}

function normalizeState(input: Partial<DashboardState> | null | undefined): DashboardState {
  const fallback = createDefaultState();

  return {
    settings: {
      ...fallback.settings,
      ...input?.settings,
      gatewayAuthToken: input?.settings?.gatewayAuthToken || fallback.settings.gatewayAuthToken,
      updatedAt: input?.settings?.updatedAt ?? fallback.settings.updatedAt,
    },
    sandbox: input?.sandbox
      ? {
          ...input.sandbox,
          sourceSnapshotId: input.sandbox.sourceSnapshotId ?? null,
          expiresAt: input.sandbox.expiresAt ?? null,
          lastSnapshotAt: input.sandbox.lastSnapshotAt ?? null,
        }
      : fallback.sandbox,
    sessions: Array.isArray(input?.sessions) ? input.sessions : fallback.sessions,
    commands: Array.isArray(input?.commands) ? input.commands : fallback.commands,
    usage: Array.isArray(input?.usage) ? input.usage : fallback.usage,
  };
}

async function writeStateRecord(state: DashboardState) {
  await fetchMutation(api.dashboard.upsertState, {
    key: STATE_KEY,
    payload: await serializeState(state),
  });
}

export async function readDashboardState(): Promise<DashboardState> {
  const record = await fetchQuery(api.dashboard.getState, { key: STATE_KEY });

  if (!record) {
    const initialState = createDefaultState();
    await writeStateRecord(initialState);
    return initialState;
  }

  try {
    const state = await deserializeState(record.payload);
    const serialized = await serializeState(state);
    const currentPayload = JSON.stringify(record.payload);
    const nextPayload = JSON.stringify(serialized);

    if (currentPayload !== nextPayload) {
      await fetchMutation(api.dashboard.upsertState, {
        key: STATE_KEY,
        payload: serialized,
      });
    }

    return state;
  } catch (error) {
    if (!isEncryptionAuthError(error)) {
      throw error;
    }

    const initialState = createDefaultState();
    await writeStateRecord(initialState);
    return initialState;
  }
}

export async function updateDashboardState(
  updater: (current: DashboardState) => DashboardState | Promise<DashboardState>,
): Promise<DashboardState> {
  let updatedState: DashboardState | null = null;

  writeQueue = writeQueue.then(async () => {
    const current = await readDashboardState();
    updatedState = normalizeState(await updater(current));
    await writeStateRecord(updatedState);
  });

  await writeQueue;
  return updatedState ?? readDashboardState();
}

export function appendCommand(
  commands: CommandRecord[],
  nextCommand: CommandRecord,
  limit = 18,
): CommandRecord[] {
  return [nextCommand, ...commands].slice(0, limit);
}

export function appendUsage(usage: UsageSnapshot[], snapshot: UsageSnapshot, limit = 24) {
  return [snapshot, ...usage].slice(0, limit);
}
