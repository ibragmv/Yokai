import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  settings: defineTable({
    key: v.string(),
    displayName: v.string(),
    telegramBotToken: v.string(),
    aiGatewayApiKey: v.string(),
    vercelApiToken: v.string(),
    vercelProjectId: v.string(),
    vercelTeamId: v.string(),
    allowedUserIds: v.string(),
    allowedGroupIds: v.string(),
    requireMention: v.boolean(),
    timeoutSeconds: v.number(),
    defaultModel: v.string(),
    gatewayAuthToken: v.string(),
    updatedAt: v.number(),
  }).index('by_key', ['key']),
  sandboxes: defineTable({
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
  })
    .index('by_sandbox_id', ['sandboxId'])
    .index('by_updated_at', ['updatedAt']),
  sessions: defineTable({
    sandboxId: v.string(),
    sessionKey: v.string(),
    agentId: v.string(),
    model: v.union(v.string(), v.null()),
    updatedAt: v.number(),
    totalTokens: v.union(v.number(), v.null()),
    contextTokens: v.union(v.number(), v.null()),
  })
    .index('by_sandbox', ['sandboxId'])
    .index('by_sandbox_and_session_key', ['sandboxId', 'sessionKey']),
  commands: defineTable({
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
  })
    .index('by_cmd_id', ['cmdId'])
    .index('by_sandbox', ['sandboxId'])
    .index('by_started_at', ['startedAt']),
  usageSnapshots: defineTable({
    source: v.union(v.literal('ai-gateway'), v.literal('sandbox')),
    creditsRemaining: v.union(v.number(), v.null()),
    creditsUsed: v.union(v.number(), v.null()),
    cpuMs: v.union(v.number(), v.null()),
    networkBytes: v.union(v.number(), v.null()),
    recordedAt: v.number(),
  })
    .index('by_source', ['source'])
    .index('by_recorded_at', ['recordedAt']),
});
