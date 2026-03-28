import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

const sessionValidator = v.object({
  sessionKey: v.string(),
  agentId: v.string(),
  model: v.union(v.string(), v.null()),
  updatedAt: v.number(),
  totalTokens: v.union(v.number(), v.null()),
  contextTokens: v.union(v.number(), v.null()),
});

export const listBySandbox = query({
  args: {
    sandboxId: v.string(),
  },
  returns: v.array(sessionValidator),
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query('sessions')
      .withIndex('by_sandbox', (q) => q.eq('sandboxId', args.sandboxId))
      .collect();

    return sessions.map((session) => ({
      sessionKey: session.sessionKey,
      agentId: session.agentId,
      model: session.model,
      updatedAt: session.updatedAt,
      totalTokens: session.totalTokens,
      contextTokens: session.contextTokens,
    }));
  },
});

export const replaceForSandbox = mutation({
  args: {
    sandboxId: v.string(),
    sessions: v.array(
      v.object({
        sessionKey: v.string(),
        agentId: v.string(),
        model: v.union(v.string(), v.null()),
        updatedAt: v.number(),
        totalTokens: v.union(v.number(), v.null()),
        contextTokens: v.union(v.number(), v.null()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('sessions')
      .withIndex('by_sandbox', (q) => q.eq('sandboxId', args.sandboxId))
      .collect();

    for (const session of existing) {
      await ctx.db.delete('sessions', session._id);
    }

    await Promise.all(
      args.sessions.map((session) =>
        ctx.db.insert('sessions', {
          sandboxId: args.sandboxId,
          sessionKey: session.sessionKey,
          agentId: session.agentId,
          model: session.model,
          updatedAt: session.updatedAt,
          totalTokens: session.totalTokens,
          contextTokens: session.contextTokens,
        }),
      ),
    );
    return null;
  },
});
