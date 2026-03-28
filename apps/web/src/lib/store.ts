import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  CommandRecord,
  DashboardSettings,
  SandboxRecord,
  SessionRecord,
  UsageSnapshot,
} from '@/lib/types';

export type DashboardState = {
  settings: DashboardSettings;
  sandbox: SandboxRecord | null;
  sessions: SessionRecord[];
  commands: CommandRecord[];
  usage: UsageSnapshot[];
};

const DATA_DIRECTORY = path.join(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIRECTORY, 'yokai-control-plane.json');

let writeQueue = Promise.resolve();

function createDefaultState(): DashboardState {
  return {
    settings: {
      displayName: 'Yokai Control Room',
      telegramBotToken: '',
      aiGatewayApiKey: process.env.AI_GATEWAY_API_KEY ?? '',
      vercelApiToken: process.env.VERCEL_ACCESS_TOKEN ?? '',
      vercelProjectId: process.env.VERCEL_PROJECT_ID ?? '',
      vercelTeamId: process.env.VERCEL_TEAM_ID ?? '',
      allowedUserIds: '',
      allowedGroupIds: '',
      requireMention: true,
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

async function ensureDataFile() {
  await mkdir(DATA_DIRECTORY, { recursive: true });
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
    sandbox: input?.sandbox ?? fallback.sandbox,
    sessions: Array.isArray(input?.sessions) ? input.sessions : fallback.sessions,
    commands: Array.isArray(input?.commands) ? input.commands : fallback.commands,
    usage: Array.isArray(input?.usage) ? input.usage : fallback.usage,
  };
}

async function writeStateFile(state: DashboardState) {
  await ensureDataFile();
  await writeFile(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
}

export async function readDashboardState(): Promise<DashboardState> {
  try {
    const raw = await readFile(DATA_FILE, 'utf8');
    return normalizeState(JSON.parse(raw) as DashboardState);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const initialState = createDefaultState();
      await writeStateFile(initialState);
      return initialState;
    }

    throw error;
  }
}

export async function writeDashboardState(nextState: DashboardState): Promise<DashboardState> {
  const normalized = normalizeState(nextState);

  writeQueue = writeQueue.then(async () => {
    await writeStateFile(normalized);
  });

  await writeQueue;
  return normalized;
}

export async function updateDashboardState(
  updater: (current: DashboardState) => DashboardState | Promise<DashboardState>,
): Promise<DashboardState> {
  let updatedState: DashboardState | null = null;

  writeQueue = writeQueue.then(async () => {
    const current = await readDashboardState();
    updatedState = normalizeState(await updater(current));
    await writeStateFile(updatedState);
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
