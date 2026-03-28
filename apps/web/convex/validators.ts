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
    activeCpuUsageMs: v.union(v.number(), v.null()),
    networkBytes: v.union(v.number(), v.null()),
    openClawVersion: v.union(v.string(), v.null()),
    errorMessage: v.union(v.string(), v.null()),
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
  sessions: v.array(sessionRecordValidator),
  commands: v.array(commandRecordValidator),
  usage: v.array(usageSnapshotValidator),
});

export const dashboardStateRecordValidator = v.object({
  _id: v.id('dashboardState'),
  _creationTime: v.number(),
  key: v.string(),
  payload: dashboardStatePayloadValidator,
});

export const adminCredentialValidator = v.object({
  _id: v.id('adminCredentials'),
  _creationTime: v.number(),
  login: v.string(),
  passwordHash: v.string(),
  passwordSalt: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const adminSessionValidator = v.object({
  _id: v.id('adminSessions'),
  _creationTime: v.number(),
  credentialId: v.id('adminCredentials'),
  tokenHash: v.string(),
  expiresAt: v.number(),
  createdAt: v.number(),
  lastSeenAt: v.number(),
});
