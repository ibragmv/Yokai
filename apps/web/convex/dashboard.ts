import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

import { dashboardStatePayloadValidator, dashboardStateRecordValidator } from './validators';

export const getState = query({
  args: {
    key: v.string(),
  },
  returns: v.union(dashboardStateRecordValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query('states')
      .withIndex('by_key', (q) => q.eq('key', args.key))
      .unique();
  },
});

export const upsertState = mutation({
  args: {
    key: v.string(),
    payload: dashboardStatePayloadValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('states')
      .withIndex('by_key', (q) => q.eq('key', args.key))
      .unique();

    if (existing) {
      await ctx.db.patch('states', existing._id, {
        payload: args.payload,
        updatedAt: Date.now(),
      });
      return null;
    }

    await ctx.db.insert('states', {
      key: args.key,
      payload: args.payload,
      updatedAt: Date.now(),
    });
    return null;
  },
});
