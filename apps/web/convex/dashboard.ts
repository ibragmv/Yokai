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
      .query('dashboardState')
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
      .query('dashboardState')
      .withIndex('by_key', (q) => q.eq('key', args.key))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        payload: args.payload,
      });
      return null;
    }

    await ctx.db.insert('dashboardState', {
      key: args.key,
      payload: args.payload,
    });
    return null;
  },
});
