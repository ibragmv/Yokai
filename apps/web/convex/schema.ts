import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

import { dashboardStatePayloadValidator } from './validators';

export default defineSchema({
  states: defineTable({
    key: v.string(),
    payload: dashboardStatePayloadValidator,
    updatedAt: v.number(),
  }).index('by_key', ['key']),
  snapshots: defineTable({
    key: v.string(),
    snapshotId: v.string(),
    sourceSandboxId: v.string(),
    createdAt: v.number(),
    expiresAt: v.union(v.number(), v.null()),
    sessionCount: v.optional(v.union(v.number(), v.null())),
    backupBundleStorageId: v.optional(v.union(v.id('_storage'), v.null())),
    backupBundleSize: v.optional(v.union(v.number(), v.null())),
    updatedAt: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_snapshot_id', ['snapshotId']),
  credentials: defineTable({
    key: v.string(),
    login: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_login', ['login']),
  sessions: defineTable({
    credentialId: v.id('credentials'),
    tokenHash: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index('by_credential', ['credentialId'])
    .index('by_token_hash', ['tokenHash']),
});
