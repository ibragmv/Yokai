import { v } from 'convex/values';

import { mutation, query } from './_generated/server';

import {
  dashboardStatePayloadValidator,
  dashboardStateRecordValidator,
  leaseAcquireResultValidator,
} from './validators';

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

export const acquireOperationLease = mutation({
  args: {
    key: v.string(),
    owner: v.string(),
    type: v.union(v.literal('start'), v.literal('stop'), v.literal('sync'), v.literal('reconcile')),
    ttlMs: v.number(),
  },
  returns: leaseAcquireResultValidator,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('states')
      .withIndex('by_key', (q) => q.eq('key', args.key))
      .unique();

    if (!existing) {
      return {
        acquired: false,
        lease: null,
      };
    }

    const now = Date.now();
    const currentLease = existing.payload.operationLease;

    if (currentLease && currentLease.expiresAt > now && currentLease.owner !== args.owner) {
      return {
        acquired: false,
        lease: currentLease,
      };
    }

    const lease = {
      owner: args.owner,
      type: args.type,
      acquiredAt: now,
      expiresAt: now + Math.max(args.ttlMs, 5_000),
    };

    await ctx.db.patch(existing._id, {
      payload: {
        ...existing.payload,
        operationLease: lease,
      },
      updatedAt: now,
    });

    return {
      acquired: true,
      lease,
    };
  },
});

export const releaseOperationLease = mutation({
  args: {
    key: v.string(),
    owner: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('states')
      .withIndex('by_key', (q) => q.eq('key', args.key))
      .unique();

    if (!existing) {
      return null;
    }

    const currentLease = existing.payload.operationLease;
    if (!currentLease || currentLease.owner !== args.owner) {
      return null;
    }

    await ctx.db.patch(existing._id, {
      payload: {
        ...existing.payload,
        operationLease: null,
      },
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const removeLegacyStoredSnapshot = mutation({
  args: {
    key: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('states')
      .withIndex('by_key', (q) => q.eq('key', args.key))
      .unique();

    if (!existing || existing.payload.storedSnapshot === undefined) {
      return null;
    }

    const payload = {
      ...existing.payload,
      storedSnapshot: undefined,
    };

    await ctx.db.patch('states', existing._id, {
      payload,
      updatedAt: Date.now(),
    });
    return null;
  },
});
