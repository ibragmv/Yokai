import { NextResponse } from 'next/server';

import { api, getConvexClient } from '@/lib/convex/server';
import { loadDashboardPayload } from '@/lib/dashboard/data';
import { fetchGatewayCredits } from '@/lib/gateway/usage';
import {
  createOpenClawSandbox,
  stopOpenClawSandbox,
  syncOpenClawSessions,
} from '@/lib/sandbox/openclaw';

type SandboxAction = 'start' | 'stop' | 'sync';

export async function POST(request: Request) {
  const body = (await request.json()) as { action: SandboxAction };
  const client = getConvexClient();
  const settings = await client.query(api.settings.get, {});
  const currentSandbox = await client.query(api.sandboxes.getCurrent, {});

  if (body.action === 'start') {
    const { sandboxRecord, installCommand } = await createOpenClawSandbox(settings);
    await client.mutation(api.sandboxes.upsert, sandboxRecord);
    await client.mutation(api.telemetry.logCommand, installCommand);
  }

  if (body.action === 'stop' && currentSandbox) {
    await stopOpenClawSandbox(currentSandbox.sandboxId);
    await client.mutation(api.sandboxes.upsert, {
      ...currentSandbox,
      status: 'stopped',
      updatedAt: Date.now(),
    });
  }

  if (body.action === 'sync' && currentSandbox) {
    const synced = await syncOpenClawSessions(currentSandbox.sandboxId);
    await client.mutation(api.sandboxes.upsert, synced.sandbox);
    await client.mutation(api.sessions.replaceForSandbox, {
      sandboxId: currentSandbox.sandboxId,
      sessions: synced.sessions,
    });
    for (const command of synced.commands) {
      await client.mutation(api.telemetry.logCommand, command);
    }
    await client.mutation(api.telemetry.recordUsage, {
      source: 'sandbox',
      creditsRemaining: null,
      creditsUsed: null,
      cpuMs: synced.sandbox.activeCpuUsageMs,
      networkBytes: synced.sandbox.networkBytes,
      recordedAt: Date.now(),
    });
  }

  try {
    const credits = await fetchGatewayCredits(settings.aiGatewayApiKey || undefined);
    if (credits) {
      await client.mutation(api.telemetry.recordUsage, {
        source: 'ai-gateway',
        creditsRemaining:
          typeof credits.remainingCredits === 'number' ? credits.remainingCredits : null,
        creditsUsed: typeof credits.usedCredits === 'number' ? credits.usedCredits : null,
        cpuMs: null,
        networkBytes: null,
        recordedAt: Date.now(),
      });
    }
  } catch {}

  const payload = await loadDashboardPayload();
  return NextResponse.json(payload);
}
