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

export const clear = mutation({
  args: {
    key: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('snapshots')
      .withIndex('by_key', (q) => q.eq('key', args.key))
      .unique();

    if (!existing) {
      return null;
    }

    await ctx.db.delete(existing._id);
    return null;
  },
});

export const migrateLegacyFromState = mutation({
  args: {
    stateKey: v.string(),
    snapshotKey: v.string(),
  },
  returns: v.union(snapshotValueValidator, v.null()),
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query('states')
      .withIndex('by_key', (q) => q.eq('key', args.stateKey))
      .unique();
    const legacySnapshot = state?.payload.storedSnapshot ?? null;

    if (!legacySnapshot) {
      return null;
    }

    const existingSnapshot = await ctx.db
      .query('snapshots')
      .withIndex('by_key', (q) => q.eq('key', args.snapshotKey))
      .unique();

    if (existingSnapshot) {
      await ctx.db.patch('snapshots', existingSnapshot._id, legacySnapshot);
    } else {
      await ctx.db.insert('snapshots', {
        key: args.snapshotKey,
        ...legacySnapshot,
      });
    }

    if (state) {
      await ctx.db.patch('states', state._id, {
        payload: {
          ...state.payload,
          storedSnapshot: undefined,
        },
        updatedAt: Date.now(),
      });
    }

    return legacySnapshot;
  },
});
