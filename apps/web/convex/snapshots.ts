import { v } from 'convex/values';

import { type MutationCtx, type QueryCtx, mutation, query } from './_generated/server';
import { snapshotRecordValidator, snapshotValueValidator } from './validators';

type SnapshotLookupCtx = Pick<QueryCtx | MutationCtx, 'db'>;

async function getSnapshotByKey(ctx: SnapshotLookupCtx, key: string) {
  return await ctx.db
    .query('snapshots')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique();
}

export const get = query({
  args: {
    key: v.string(),
  },
  returns: v.union(snapshotRecordValidator, v.null()),
  handler: async (ctx, args) => {
    return await getSnapshotByKey(ctx, args.key);
  },
});

export const upsert = mutation({
  args: {
    key: v.string(),
    snapshot: snapshotValueValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await getSnapshotByKey(ctx, args.key);

    if (existing) {
      await ctx.db.patch('snapshots', existing._id, args.snapshot);
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
    const existing = await getSnapshotByKey(ctx, args.key);

    if (!existing) {
      return null;
    }

    await ctx.db.delete('snapshots', existing._id);
    return null;
  },
});

export const generateBackupUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const getBackupAssetUrl = query({
  args: {
    storageId: v.id('_storage'),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});

export const deleteBackupAsset = mutation({
  args: {
    storageId: v.id('_storage'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.storage.delete(args.storageId);
    return null;
  },
});

