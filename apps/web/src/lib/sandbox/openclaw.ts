import 'server-only';

import { Sandbox } from '@vercel/sandbox';

import { buildOpenClawConfig, sandboxEnvironment } from '@/lib/openclaw/config';
import {
  deleteRemoteSnapshot,
  loadStoredSnapshot,
  saveStoredSnapshot,
} from '@/lib/persistence/openclaw-snapshots';
import { redactSecrets } from '@/lib/security/redaction';
import { appendCommand, readDashboardState, updateDashboardState } from '@/lib/store';
import type { CommandRecord, DashboardSettings, SandboxRecord, SessionRecord } from '@/lib/types';
import { truncate } from '@/lib/utils';

const OPENCLAW_ROOT = '/vercel/sandbox/openclaw';
const DEFAULT_RUNTIME = 'node24';
const SNAPSHOT_EXPIRATION_MS = 0;

let lifecycleReconcile: Promise<void> | null = null;

function getSandboxTimeoutMs(settings: DashboardSettings) {
  return Math.max(settings.timeoutSeconds, 60) * 1000;
}

function getExpiresAt(startedAt: number, settings: DashboardSettings) {
  return startedAt + getSandboxTimeoutMs(settings);
}

function getRolloverWindowMs(timeoutMs: number) {
  return Math.min(60_000, Math.max(5_000, Math.floor(timeoutMs * 0.1)));
}

function createSystemCommand(
  sandboxId: string,
  command: string,
  stdout: string,
  startedAt = Date.now(),
): CommandRecord {
  return {
    cmdId: `${command}-${startedAt}`,
    sandboxId,
    command,
    args: [],
    status: 'succeeded',
    exitCode: 0,
    stdout,
    stderr: null,
    startedAt,
    finishedAt: startedAt,
  };
}

function getNetworkBytes(sandbox: Sandbox) {
  if (!sandbox.networkTransfer) {
    return null;
  }

  return sandbox.networkTransfer.ingress + sandbox.networkTransfer.egress;
}

export async function createOpenClawSandbox(settings: DashboardSettings): Promise<{
  sandboxRecord: SandboxRecord;
  commands: CommandRecord[];
}> {
  const storedSnapshot = await loadStoredSnapshot();
  const timeout = getSandboxTimeoutMs(settings);
  const sandbox = storedSnapshot
    ? await Sandbox.create({
        source: {
          type: 'snapshot',
          snapshotId: storedSnapshot.snapshotId,
        },
        ports: [18789],
        timeout,
        env: sandboxEnvironment(settings),
      })
    : await Sandbox.create({
        runtime: DEFAULT_RUNTIME,
        ports: [18789],
        timeout,
        env: sandboxEnvironment(settings),
      });

  await sandbox.mkDir(OPENCLAW_ROOT);
  await sandbox.mkDir(`${OPENCLAW_ROOT}/state`);
  await sandbox.mkDir(`${OPENCLAW_ROOT}/workspace`);
  await sandbox.writeFiles([
    {
      path: `${OPENCLAW_ROOT}/openclaw.json`,
      content: Buffer.from(buildOpenClawConfig(settings)),
    },
  ]);

  const commands: CommandRecord[] = [];

  if (!storedSnapshot) {
    const installResult = await runTrackedCommand(sandbox, {
      cmd: 'bash',
      args: [
        '-lc',
        [
          'export SHARP_IGNORE_GLOBAL_LIBVIPS=1',
          'curl -fsSL --proto "=https" --tlsv1.2 https://openclaw.ai/install.sh | bash -s -- --no-prompt --no-onboard',
        ].join(' && '),
      ],
      settings,
    });

    commands.push(installResult);

    if (installResult.status === 'failed') {
      throw new Error(
        installResult.stderr || installResult.stdout || 'OpenClaw installation failed',
      );
    }
  } else {
    commands.push(
      createSystemCommand(
        sandbox.sandboxId,
        'system:restore-snapshot',
        `Restored sandbox from snapshot ${storedSnapshot.snapshotId}.`,
      ),
    );
  }

  await runTrackedCommand(sandbox, {
    cmd: 'bash',
    args: [
      '-lc',
      [
        `export OPENCLAW_CONFIG_PATH=${OPENCLAW_ROOT}/openclaw.json`,
        `export OPENCLAW_STATE_DIR=${OPENCLAW_ROOT}/state`,
        'openclaw gateway',
      ].join(' && '),
    ],
    detached: true,
    settings,
  });

  const version = await sandbox.runCommand('bash', ['-lc', 'openclaw --version']);
  const previewUrl = sandbox.domain(18789);
  const startedAt = Date.now();

  return {
    sandboxRecord: {
      sandboxId: sandbox.sandboxId,
      status: 'running',
      runtime: DEFAULT_RUNTIME,
      previewUrl,
      gatewayUrl: previewUrl,
      sourceSnapshotId: sandbox.sourceSnapshotId ?? storedSnapshot?.snapshotId ?? null,
      activeCpuUsageMs: sandbox.activeCpuUsageMs ?? null,
      networkBytes: getNetworkBytes(sandbox),
      openClawVersion: (await version.stdout()).trim() || null,
      errorMessage: null,
      expiresAt: getExpiresAt(startedAt, settings),
      lastSnapshotAt: storedSnapshot?.updatedAt ?? null,
      startedAt,
      updatedAt: startedAt,
    },
    commands,
  };
}

export async function runTrackedCommand(
  sandbox: Sandbox,
  input: {
    cmd: string;
    args?: string[];
    detached?: boolean;
    settings: DashboardSettings;
  },
): Promise<CommandRecord> {
  const startedAt = Date.now();

  if (input.detached) {
    const command = await sandbox.runCommand({
      cmd: input.cmd,
      args: input.args,
      detached: true,
      cwd: OPENCLAW_ROOT,
    });

    return {
      cmdId: command.cmdId,
      sandboxId: sandbox.sandboxId,
      command: input.cmd,
      args: input.args ?? [],
      status: 'running',
      exitCode: null,
      stdout: null,
      stderr: null,
      startedAt,
      finishedAt: null,
    };
  }

  const result = await sandbox.runCommand({
    cmd: input.cmd,
    args: input.args,
    cwd: OPENCLAW_ROOT,
  });
  const stdout = truncate(await result.stdout());
  const stderr = truncate(await result.stderr());

  return {
    cmdId: result.cmdId,
    sandboxId: sandbox.sandboxId,
    command: input.cmd,
    args: input.args ?? [],
    status: result.exitCode === 0 ? 'succeeded' : 'failed',
    exitCode: result.exitCode,
    stdout: redactSecrets(stdout, input.settings) || null,
    stderr: redactSecrets(stderr, input.settings) || null,
    startedAt,
    finishedAt: Date.now(),
  };
}

export async function syncOpenClawSessions(
  sandboxId: string,
  settings: DashboardSettings,
): Promise<{
  sandbox: SandboxRecord;
  sessions: SessionRecord[];
  commands: CommandRecord[];
}> {
  const sandbox = await Sandbox.get({ sandboxId });
  const startedAt = Date.now();
  const args = [
    '-lc',
    [
      `export OPENCLAW_CONFIG_PATH=${OPENCLAW_ROOT}/openclaw.json`,
      `export OPENCLAW_STATE_DIR=${OPENCLAW_ROOT}/state`,
      'openclaw sessions --all-agents --json',
    ].join(' && '),
  ];
  const sessionsResult = await sandbox.runCommand({
    cmd: 'bash',
    args,
    cwd: OPENCLAW_ROOT,
  });
  const rawStdout = await sessionsResult.stdout();
  const rawStderr = await sessionsResult.stderr();
  const sessionsCommand: CommandRecord = {
    cmdId: sessionsResult.cmdId,
    sandboxId,
    command: 'bash',
    args,
    status: sessionsResult.exitCode === 0 ? 'succeeded' : 'failed',
    exitCode: sessionsResult.exitCode,
    stdout: redactSecrets(truncate(rawStdout), settings) || null,
    stderr: redactSecrets(truncate(rawStderr), settings) || null,
    startedAt,
    finishedAt: Date.now(),
  };

  const parsed = rawStdout ? JSON.parse(rawStdout) : { sessions: [] };
  const sessions = Array.isArray(parsed.sessions)
    ? parsed.sessions.map((session: Record<string, unknown>) => ({
        sessionKey: String(session.key ?? ''),
        agentId: String(session.agentId ?? 'main'),
        model: typeof session.model === 'string' ? session.model : null,
        updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : Date.now(),
        totalTokens: typeof session.totalTokens === 'number' ? session.totalTokens : null,
        contextTokens: typeof session.contextTokens === 'number' ? session.contextTokens : null,
      }))
    : [];
  const storedSnapshot = await loadStoredSnapshot();

  return {
    sandbox: {
      sandboxId,
      status: sandbox.status === 'running' ? 'running' : 'error',
      runtime: 'node24',
      previewUrl: sandbox.domain(18789),
      gatewayUrl: sandbox.domain(18789),
      sourceSnapshotId: sandbox.sourceSnapshotId ?? null,
      activeCpuUsageMs: sandbox.activeCpuUsageMs ?? null,
      networkBytes: getNetworkBytes(sandbox),
      openClawVersion: null,
      errorMessage: null,
      startedAt: sandbox.createdAt.getTime(),
      expiresAt: sandbox.createdAt.getTime() + sandbox.timeout,
      lastSnapshotAt: storedSnapshot?.updatedAt ?? null,
      updatedAt: Date.now(),
    },
    sessions,
    commands: [sessionsCommand],
  };
}

export async function snapshotOpenClawSandbox(
  sandboxId: string,
  _settings: DashboardSettings,
): Promise<CommandRecord | null> {
  const previousSnapshot = await loadStoredSnapshot();
  const sandbox = await Sandbox.get({ sandboxId });
  const startedAt = Date.now();
  const snapshot = await sandbox.snapshot({ expiration: SNAPSHOT_EXPIRATION_MS });
  await saveStoredSnapshot(snapshot);

  if (previousSnapshot && previousSnapshot.snapshotId !== snapshot.snapshotId) {
    await deleteRemoteSnapshot(previousSnapshot.snapshotId);
  }

  return createSystemCommand(
    sandboxId,
    'system:create-snapshot',
    `Stored snapshot ${snapshot.snapshotId} in Convex.`,
    startedAt,
  );
}

export async function stopOpenClawSandbox(sandboxId: string) {
  const sandbox = await Sandbox.get({ sandboxId });
  await sandbox.stop();
}

export async function reconcileOpenClawSandboxLifecycle() {
  if (lifecycleReconcile) {
    await lifecycleReconcile;
    return;
  }

  lifecycleReconcile = (async () => {
    try {
      const state = await readDashboardState();
      if (
        !state.sandbox ||
        state.sandbox.status !== 'running' ||
        !state.settings.autoRecreateSandbox
      ) {
        return;
      }

      const timeoutMs = getSandboxTimeoutMs(state.settings);
      const rolloverAt = state.sandbox.startedAt + timeoutMs - getRolloverWindowMs(timeoutMs);
      if (Date.now() < rolloverAt) {
        return;
      }

      const previousSnapshot = await loadStoredSnapshot();
      let snapshotCommand: CommandRecord | null = null;

      try {
        snapshotCommand = await snapshotOpenClawSandbox(state.sandbox.sandboxId, state.settings);
      } catch {}

      const { sandboxRecord, commands } = await createOpenClawSandbox(state.settings);
      const nextCommands = [...(snapshotCommand ? [snapshotCommand] : []), ...commands];

      await updateDashboardState((current) => ({
        ...current,
        sandbox: {
          ...sandboxRecord,
          lastSnapshotAt: snapshotCommand?.finishedAt ?? sandboxRecord.lastSnapshotAt,
        },
        sessions: [],
        commands: nextCommands.reduce(
          (items, command) => appendCommand(items, command),
          current.commands,
        ),
      }));

      if (previousSnapshot && previousSnapshot.snapshotId !== sandboxRecord.sourceSnapshotId) {
        await deleteRemoteSnapshot(previousSnapshot.snapshotId);
      }
    } catch (error) {
      const state = await readDashboardState();
      await updateDashboardState((current) => ({
        ...current,
        sandbox: current.sandbox
          ? {
              ...current.sandbox,
              status: 'error',
              errorMessage:
                redactSecrets(
                  error instanceof Error ? error.message : 'Sandbox rollover failed.',
                  state.settings,
                ) ?? 'Sandbox rollover failed.',
              updatedAt: Date.now(),
            }
          : null,
      }));
    }
  })().finally(() => {
    lifecycleReconcile = null;
  });

  await lifecycleReconcile;
}
