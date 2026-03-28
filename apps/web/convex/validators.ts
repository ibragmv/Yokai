import { v } from 'convex/values';

export const encryptedFieldValidator = v.object({
  iv: v.string(),
  tag: v.string(),
  value: v.string(),
});

export const settingsValidator = v.object({
  displayName: v.string(),
  vercelProjectId: v.string(),
  vercelTeamId: v.string(),
  allowedUserIds: v.string(),
  allowedGroupIds: v.string(),
  requireMention: v.boolean(),
  autoRecreateSandbox: v.optional(v.boolean()),
  timeoutSeconds: v.number(),
  defaultModel: v.string(),
  updatedAt: v.union(v.number(), v.null()),
});

export const encryptedSettingsValidator = v.object({
  telegramBotToken: encryptedFieldValidator,
  aiGatewayApiKey: encryptedFieldValidator,
  vercelApiToken: encryptedFieldValidator,
  gatewayAuthToken: encryptedFieldValidator,
});

export const snapshotValueValidator = v.object({
  snapshotId: v.string(),
  sourceSandboxId: v.string(),
  createdAt: v.number(),
  expiresAt: v.union(v.number(), v.null()),
  updatedAt: v.number(),
});

export const storedSnapshotValidator = v.union(snapshotValueValidator, v.null());

export const snapshotRecordValidator = v.object({
  _id: v.id('snapshots'),
  _creationTime: v.number(),
  key: v.string(),
  snapshotId: v.string(),
  sourceSandboxId: v.string(),
  createdAt: v.number(),
  expiresAt: v.union(v.number(), v.null()),
  updatedAt: v.number(),
});

export const sandboxValidator = v.union(
  v.object({
    sandboxId: v.string(),
    status: v.union(
      v.literal('idle'),
      v.literal('starting'),
      v.literal('running'),
      v.literal('stopped'),
      v.literal('error'),
    ),
    runtime: v.string(),
    previewUrl: v.union(v.string(), v.null()),
    gatewayUrl: v.union(v.string(), v.null()),
    sourceSnapshotId: v.optional(v.union(v.string(), v.null())),
    activeCpuUsageMs: v.union(v.number(), v.null()),
    networkBytes: v.union(v.number(), v.null()),
    openClawVersion: v.union(v.string(), v.null()),
    errorMessage: v.union(v.string(), v.null()),
    expiresAt: v.optional(v.union(v.number(), v.null())),
    lastSnapshotAt: v.optional(v.union(v.number(), v.null())),
    startedAt: v.number(),
    updatedAt: v.number(),
  }),
  v.null(),
);

export const sessionRecordValidator = v.object({
  sessionKey: v.string(),
  agentId: v.string(),
  model: v.union(v.string(), v.null()),
  updatedAt: v.number(),
  totalTokens: v.union(v.number(), v.null()),
  contextTokens: v.union(v.number(), v.null()),
});

export const commandRecordValidator = v.object({
  cmdId: v.string(),
  sandboxId: v.string(),
  command: v.string(),
  args: v.array(v.string()),
  status: v.union(v.literal('running'), v.literal('succeeded'), v.literal('failed')),
  exitCode: v.union(v.number(), v.null()),
  stdout: v.union(v.string(), v.null()),
  stderr: v.union(v.string(), v.null()),
  startedAt: v.number(),
  finishedAt: v.union(v.number(), v.null()),
});

export const usageSnapshotValidator = v.object({
  source: v.union(v.literal('ai-gateway'), v.literal('sandbox')),
  creditsRemaining: v.union(v.number(), v.null()),
  creditsUsed: v.union(v.number(), v.null()),
  cpuMs: v.union(v.number(), v.null()),
  networkBytes: v.union(v.number(), v.null()),
  recordedAt: v.number(),
});

export const dashboardStatePayloadValidator = v.object({
  settings: settingsValidator,
  encryptedSettings: encryptedSettingsValidator,
  sandbox: sandboxValidator,
  // Legacy compatibility for older `states` rows before snapshot data moved
  // into the dedicated `snapshots` table.
  storedSnapshot: v.optional(storedSnapshotValidator),
  sessions: v.array(sessionRecordValidator),
  commands: v.array(commandRecordValidator),
  usage: v.array(usageSnapshotValidator),
});

export const dashboardStateRecordValidator = v.object({
  _id: v.id('states'),
  _creationTime: v.number(),
  key: v.string(),
  payload: dashboardStatePayloadValidator,
  updatedAt: v.number(),
});

export const bootstrapStatusValidator = v.object({
  hasCredentials: v.boolean(),
});

export const authResultValidator = v.object({
  sessionId: v.id('sessions'),
  sessionToken: v.string(),
  login: v.string(),
});

export const validatedSessionValidator = v.union(
  v.object({
    credentialId: v.id('credentials'),
    login: v.string(),
    expiresAt: v.number(),
  }),
  v.null(),
);
