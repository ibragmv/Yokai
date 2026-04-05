import type { Id } from '@convex/_generated/dataModel';

export type SandboxStatus = 'idle' | 'starting' | 'running' | 'stopped' | 'error';
export type SandboxOperationType = 'start' | 'stop' | 'sync' | 'reconcile';

export type StorageAssetId = Id<'_storage'>;

export type SandboxOperationLease = {
  owner: string;
  type: SandboxOperationType;
  acquiredAt: number;
  expiresAt: number;
};

export type SettingsFormValues = {
  displayName: string;
  telegramBotToken: string;
  aiGatewayApiKey: string;
  allowedUserIds: string;
  allowedGroupIds: string;
  requireMention: boolean;
  autoRecreateSandbox: boolean;
  timeoutSeconds: number;
  defaultModel: string;
};

export type DashboardSettings = SettingsFormValues & {
  gatewayAuthToken: string;
  updatedAt: number | null;
};

export type DashboardPublicSettings = SettingsFormValues & {
  gatewayAuthToken: string;
  updatedAt: number | null;
};

export type SandboxRecord = {
  sandboxId: string;
  status: SandboxStatus;
  runtime: string;
  gatewayUrl: string | null;
  sourceSnapshotId: string | null;
  activeCpuUsageMs: number | null;
  networkBytes: number | null;
  openClawVersion: string | null;
  errorMessage: string | null;
  expiresAt: number | null;
  lastSnapshotAt: number | null;
  startedAt: number;
  updatedAt: number;
};

export type SessionRecord = {
  sessionKey: string;
  agentId: string;
  model: string | null;
  updatedAt: number;
  totalTokens: number | null;
  contextTokens: number | null;
};

export type CommandRecord = {
  cmdId: string;
  sandboxId: string;
  command: string;
  args: string[];
  status: 'running' | 'succeeded' | 'failed';
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  startedAt: number;
  finishedAt: number | null;
};

export type UsageSnapshot = {
  source: 'ai-gateway' | 'sandbox';
  creditsRemaining: number | null;
  creditsUsed: number | null;
  cpuMs: number | null;
  networkBytes: number | null;
  recordedAt: number;
};

export type StoredSnapshotRecord = {
  snapshotId: string;
  sourceSandboxId: string;
  createdAt: number;
  expiresAt: number | null;
  sessionCount: number | null;
  backupBundleStorageId: StorageAssetId | null;
  backupBundleSize: number | null;
  updatedAt: number;
};

export type DashboardPayload = {
  settings: DashboardPublicSettings;
  sandbox: SandboxRecord | null;
  storedSnapshot: StoredSnapshotRecord | null;
  operationLease: SandboxOperationLease | null;
  sessions: SessionRecord[];
  commands: CommandRecord[];
  usage: UsageSnapshot[];
  availableModels: string[];
};

export type DashboardOverviewPayload = Omit<DashboardPayload, 'availableModels'>;

export type DashboardActionResult = {
  ok: boolean;
  message: string;
  payload: DashboardPayload;
};
