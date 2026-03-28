import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

const sandboxValidator = v.union(
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

export const getCurrent = query({
  args: {},
  returns: sandboxValidator,
  handler: async (ctx) => {
    const [current] = await ctx.db
      .query('sandboxes')
      .withIndex('by_updated_at')
      .order('desc')
      .take(1);
    if (!current) {
      return null;
    }

    return {
      sandboxId: current.sandboxId,
      status: current.status,
      runtime: current.runtime,
      previewUrl: current.previewUrl,
      gatewayUrl: current.gatewayUrl,
      activeCpuUsageMs: current.activeCpuUsageMs,
      networkBytes: current.networkBytes,
      openClawVersion: current.openClawVersion,
      errorMessage: current.errorMessage,
      startedAt: current.startedAt,
      updatedAt: current.updatedAt,
    };
  },
});

export const upsert = mutation({
  args: {
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('sandboxes')
      .withIndex('by_sandbox_id', (q) => q.eq('sandboxId', args.sandboxId))
      .unique();

    const nextValue = { ...args };
    if (existing) {
      await ctx.db.patch('sandboxes', existing._id, nextValue);
      return null;
    }

    await ctx.db.insert('sandboxes', nextValue);
    return null;
  },
});
