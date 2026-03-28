import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

import { dashboardStatePayloadValidator } from './validators';

export default defineSchema({
  dashboardState: defineTable({
    key: v.string(),
    payload: dashboardStatePayloadValidator,
  }).index('by_key', ['key']),
  adminCredentials: defineTable({
    login: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_login', ['login']),
  adminSessions: defineTable({
    credentialId: v.id('adminCredentials'),
    tokenHash: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index('by_credential', ['credentialId'])
    .index('by_token_hash', ['tokenHash']),
});
