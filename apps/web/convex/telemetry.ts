import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

const commandValidator = v.object({
  cmdId: v.string(),
  sandboxId: v.string(),
  command: v.string(),
  args: v.array(v.string()),
  status: v.union(v.literal('running'), v.literal('succeeded'), v.literal('failed')),
  exitCode: v.union(v.number(), v.null()),
  stdout: v.union(v.string(), v.null()),
  stderr: v.union(v.string(), v.null()),
  startedAt: v.number(),
  finishedAt: v.union(v.number(), v.null()),
});

const usageValidator = v.object({
  source: v.union(v.literal('ai-gateway'), v.literal('sandbox')),
  creditsRemaining: v.union(v.number(), v.null()),
  creditsUsed: v.union(v.number(), v.null()),
  cpuMs: v.union(v.number(), v.null()),
  networkBytes: v.union(v.number(), v.null()),
  recordedAt: v.number(),
});

export const listRecentCommands = query({
  args: {},
  returns: v.array(commandValidator),
  handler: async (ctx) => {
    const commands = await ctx.db
      .query('commands')
      .withIndex('by_started_at')
      .order('desc')
      .take(20);
    return commands.map((command) => ({
      cmdId: command.cmdId,
      sandboxId: command.sandboxId,
      command: command.command,
      args: command.args,
      status: command.status,
      exitCode: command.exitCode,
      stdout: command.stdout,
      stderr: command.stderr,
      startedAt: command.startedAt,
      finishedAt: command.finishedAt,
    }));
  },
});

export const logCommand = mutation({
  args: commandValidator,
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('commands')
      .withIndex('by_cmd_id', (q) => q.eq('cmdId', args.cmdId))
      .unique();

    if (existing) {
      await ctx.db.patch('commands', existing._id, args);
      return null;
    }

    await ctx.db.insert('commands', args);
    return null;
  },
});

export const listRecentUsage = query({
  args: {},
  returns: v.array(usageValidator),
  handler: async (ctx) => {
    const snapshots = await ctx.db
      .query('usageSnapshots')
      .withIndex('by_recorded_at')
      .order('desc')
      .take(12);
    return snapshots.map((snapshot) => ({
      source: snapshot.source,
      creditsRemaining: snapshot.creditsRemaining,
      creditsUsed: snapshot.creditsUsed,
      cpuMs: snapshot.cpuMs,
      networkBytes: snapshot.networkBytes,
      recordedAt: snapshot.recordedAt,
    }));
  },
});

export const recordUsage = mutation({
  args: usageValidator,
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('usageSnapshots', args);
    return null;
  },
});
