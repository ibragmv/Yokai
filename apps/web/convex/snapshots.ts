import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { snapshotRecordValidator, snapshotValueValidator } from './validators';

export const get = query({
  args: {
    key: v.string(),
  },
  returns: v.union(snapshotRecordValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query('snapshots')
      .withIndex('by_key', (q) => q.eq('key', args.key))
      .unique();
  },
});

export const upsert = mutation({
  args: {
    key: v.string(),
    snapshot: snapshotValueValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('snapshots')
      .withIndex('by_key', (q) => q.eq('key', args.key))
      .unique();

    if (existing) {
      await ctx.db.patch('snapshots', existing._id, {
        ...args.snapshot,
      });
      return null;
    }

    await ctx.db.insert('snapshots', {
      key: args.key,
      ...args.snapshot,
    });
    return null;
  },
});
