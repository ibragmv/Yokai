import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

const settingsValidator = v.object({
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
  updatedAt: v.union(v.number(), v.null()),
});

function defaultSettings() {
  return {
    displayName: 'OpenClaw Gateway',
    telegramBotToken: '',
    aiGatewayApiKey: '',
    vercelApiToken: '',
    vercelProjectId: '',
    vercelTeamId: '',
    allowedUserIds: '',
    allowedGroupIds: '',
    requireMention: true,
    timeoutSeconds: 1800,
    defaultModel: 'vercel-ai-gateway/google/gemini-3-flash',
    gatewayAuthToken: '',
    updatedAt: null,
  };
}

export const get = query({
  args: {},
  returns: settingsValidator,
  handler: async (ctx) => {
    const existing = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'default'))
      .unique();

    if (!existing) {
      return defaultSettings();
    }

    return {
      displayName: existing.displayName,
      telegramBotToken: existing.telegramBotToken,
      aiGatewayApiKey: existing.aiGatewayApiKey,
      vercelApiToken: existing.vercelApiToken,
      vercelProjectId: existing.vercelProjectId,
      vercelTeamId: existing.vercelTeamId,
      allowedUserIds: existing.allowedUserIds,
      allowedGroupIds: existing.allowedGroupIds,
      requireMention: existing.requireMention,
      timeoutSeconds: existing.timeoutSeconds,
      defaultModel: existing.defaultModel,
      gatewayAuthToken: existing.gatewayAuthToken,
      updatedAt: existing.updatedAt,
    };
  },
});

export const upsert = mutation({
  args: {
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'default'))
      .unique();

    const nextValue = {
      key: 'default',
      displayName: args.displayName,
      telegramBotToken: args.telegramBotToken,
      aiGatewayApiKey: args.aiGatewayApiKey,
      vercelApiToken: args.vercelApiToken,
      vercelProjectId: args.vercelProjectId,
      vercelTeamId: args.vercelTeamId,
      allowedUserIds: args.allowedUserIds,
      allowedGroupIds: args.allowedGroupIds,
      requireMention: args.requireMention,
      timeoutSeconds: args.timeoutSeconds,
      defaultModel: args.defaultModel,
      gatewayAuthToken: args.gatewayAuthToken,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch('settings', existing._id, nextValue);
      return null;
    }

    await ctx.db.insert('settings', nextValue);
    return null;
  },
});
