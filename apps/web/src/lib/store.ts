import 'server-only';

import { randomUUID } from 'node:crypto';

import { fetchMutation, fetchQuery } from 'convex/nextjs';

import { DEFAULT_MODEL_ID, resolveSupportedModelId } from '@/lib/models';
import { decryptValue, encryptValue } from '@/lib/security/crypto';
import type {
  CommandRecord,
  DashboardSettings,
  SandboxOperationLease,
  SandboxOperationType,
  SandboxRecord,
  SessionRecord,
  UsageSnapshot,
} from '@/lib/types';
import { api } from '@convex/_generated/api';

export type DashboardState = {
  settings: DashboardSettings;
  sandbox: SandboxRecord | null;
  operationLease: SandboxOperationLease | null;
  sessions: SessionRecord[];
  commands: CommandRecord[];
  usage: UsageSnapshot[];
};

const STATE_KEY = 'primary';

let writeQueue = Promise.resolve();

const SECRET_SETTING_KEYS = ['telegramBotToken', 'aiGatewayApiKey', 'gatewayAuthToken'] as const;

type SecretSettingKey = (typeof SECRET_SETTING_KEYS)[number];
type EncryptedField = Awaited<ReturnType<typeof encryptValue>>;

type PersistedDashboardState = {
  settings: Omit<DashboardSettings, SecretSettingKey>;
  encryptedSettings: Record<SecretSettingKey, EncryptedField>;
  sandbox: SandboxRecord | null;
  operationLease: SandboxOperationLease | null;
  sessions: SessionRecord[];
  commands: CommandRecord[];
  usage: UsageSnapshot[];
};

function isEncryptionAuthError(error: unknown) {
  return (
    error instanceof Error && error.message === 'Unsupported state or unable to authenticate data'
  );
}

function createDefaultState(): DashboardState {
  return {
    settings: {
      displayName: 'Yokai Control Room',
      telegramBotToken: '',
      aiGatewayApiKey: process.env.AI_GATEWAY_API_KEY ?? '',
      allowedUserIds: '',
      allowedGroupIds: '',
      requireMention: true,
      autoRecreateSandbox: false,
      timeoutSeconds: 900,
      defaultModel: DEFAULT_MODEL_ID,
      gatewayAuthToken: randomUUID(),
      updatedAt: null,
    },
    sandbox: null,
    operationLease: null,
    sessions: [],
    commands: [],
    usage: [],
  };
}

function splitSettings(settings: DashboardSettings) {
  return {
    plainSettings: {
      displayName: settings.displayName,
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
      gatewayAuthToken: settings.gatewayAuthToken,
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
    operationLease: state.operationLease,
    sessions: state.sessions,
    commands: state.commands,
    usage: state.usage,
  };
}

async function deserializeState(payload: PersistedDashboardState): Promise<DashboardState> {
  const decryptedEntries = await Promise.all(
    SECRET_SETTING_KEYS.map(async (key) => {
      return [key, await decryptValue(payload.encryptedSettings[key])] as const;
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
    operationLease: payload.operationLease,
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
      defaultModel: resolveSupportedModelId(input?.settings?.defaultModel),
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
    operationLease: input?.operationLease ?? fallback.operationLease,
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
    return await deserializeState(record.payload);
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

export async function acquireSandboxOperationLease(
  type: SandboxOperationType,
  ttlMs: number,
): Promise<SandboxOperationLease | null> {
  await readDashboardState();
  const owner = randomUUID();
  const result = await fetchMutation(api.dashboard.acquireOperationLease, {
    key: STATE_KEY,
    owner,
    type,
    ttlMs,
  });

  return result.acquired && result.lease ? result.lease : null;
}

export async function releaseSandboxOperationLease(owner: string) {
  await fetchMutation(api.dashboard.releaseOperationLease, {
    key: STATE_KEY,
    owner,
  });
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
