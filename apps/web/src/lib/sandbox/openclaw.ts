import 'server-only';

import { Sandbox } from '@vercel/sandbox';

import { buildOpenClawConfig, sandboxEnvironment } from '@/lib/openclaw/config';
import {
  deleteRemoteSnapshot,
  loadStoredSnapshot,
  saveStoredSnapshot,
} from '@/lib/persistence/snapshots';
import { redactSecrets } from '@/lib/security/redaction';
import { appendCommand, readDashboardState, updateDashboardState } from '@/lib/store';
import type {
  CommandRecord,
  DashboardSettings,
  SandboxRecord,
  SessionRecord,
  StoredSnapshotRecord,
} from '@/lib/types';
import { truncate } from '@/lib/utils';

const OPENCLAW_ROOT = '/vercel/sandbox/openclaw';
const GATEWAY_LOG_PATH = `${OPENCLAW_ROOT}/state/gateway.log`;
const DEFAULT_RUNTIME = 'node24';
const GATEWAY_READY_TIMEOUT_MS = 20_000;
const GATEWAY_READY_POLL_MS = 1_000;
const SNAPSHOT_EXPIRATION_MS = 0;

export type LifecycleReconcileResult = {
  status: 'skipped' | 'recreated';
  reason:
    | 'sandbox-missing'
    | 'sandbox-not-running'
    | 'auto-recreate-disabled'
    | 'rollover-not-due'
    | 'rollover-complete'
    | 'recovery-from-snapshot'
    | 'recovery-clean-start';
  sandboxId: string | null;
  previousSandboxId: string | null;
};

let lifecycleReconcile: Promise<LifecycleReconcileResult> | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSandboxTimeoutMs(settings: DashboardSettings) {
  return Math.max(settings.timeoutSeconds, 60) * 1000;
}

function getExpiresAt(startedAt: number, settings: DashboardSettings) {
  return startedAt + getSandboxTimeoutMs(settings);
}

function getRolloverWindowMs(timeoutMs: number) {
  return Math.min(120_000, Math.max(30_000, Math.floor(timeoutMs * 0.2)));
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

function isSandboxGoneError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    /\b410\b/.test(message) || /\bgone\b/i.test(message) || /status code .* not ok/i.test(message)
  );
}

function getRestorableSnapshot(snapshot: StoredSnapshotRecord | null) {
  if (!snapshot?.snapshotId.trim()) {
    return null;
  }

  if (snapshot.expiresAt && snapshot.expiresAt <= Date.now()) {
    return null;
  }

  return snapshot;
}

function createSandboxRecord(
  sandbox: Sandbox,
  input: {
    status: SandboxRecord['status'];
    sourceSnapshotId: string | null;
    openClawVersion: string | null;
    errorMessage: string | null;
    lastSnapshotAt: number | null;
    startedAt?: number;
  },
): SandboxRecord {
  const startedAt = input.startedAt ?? Date.now();
  const previewUrl = sandbox.domain(18789);

  return {
    sandboxId: sandbox.sandboxId,
    status: input.status,
    runtime: DEFAULT_RUNTIME,
    previewUrl,
    gatewayUrl: previewUrl,
    sourceSnapshotId: input.sourceSnapshotId,
    activeCpuUsageMs: sandbox.activeCpuUsageMs ?? null,
    networkBytes: getNetworkBytes(sandbox),
    openClawVersion: input.openClawVersion,
    errorMessage: input.errorMessage,
    expiresAt: startedAt + sandbox.timeout,
    lastSnapshotAt: input.lastSnapshotAt,
    startedAt,
    updatedAt: Date.now(),
  };
}

async function probeGatewayStatus(sandbox: Sandbox) {
  const result = await sandbox.runCommand({
    cmd: 'node',
    args: [
      '-e',
      [
        "fetch('http://127.0.0.1:18789/', {",
        "  headers: { Authorization: `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN ?? ''}` },",
        '})',
        '.then((response) => console.log(String(response.status)))',
        ".catch(() => console.log('000'));",
      ].join('\n'),
    ],
    cwd: OPENCLAW_ROOT,
  });

  return (await result.stdout()).trim();
}

async function readGatewayDiagnostics(
  sandbox: Sandbox,
  settings: DashboardSettings,
): Promise<CommandRecord> {
  return await runTrackedCommand(sandbox, {
    cmd: 'bash',
    args: [
      '-lc',
      [
        `if [ -f "${GATEWAY_LOG_PATH}" ]; then`,
        `  tail -n 120 "${GATEWAY_LOG_PATH}"`,
        'else',
        `  echo "Gateway log file not found at ${GATEWAY_LOG_PATH}."`,
        'fi',
        'echo',
        'ps -ef | grep "[o]penclaw" || true',
      ].join('\n'),
    ],
    settings,
  });
}

async function waitForGatewayReady(
  sandbox: Sandbox,
  settings: DashboardSettings,
): Promise<CommandRecord | null> {
  const deadline = Date.now() + GATEWAY_READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const statusCode = await probeGatewayStatus(sandbox);
    if (statusCode && statusCode !== '000') {
      return null;
    }

    await sleep(GATEWAY_READY_POLL_MS);
  }

  return await readGatewayDiagnostics(sandbox, settings);
}

export async function isOpenClawSandboxRunning(sandboxId: string) {
  try {
    const sandbox = await Sandbox.get({ sandboxId });
    return sandbox.status === 'running';
  } catch (error) {
    if (isSandboxGoneError(error)) {
      return false;
    }

    throw error;
  }
}

export async function createOpenClawSandbox(settings: DashboardSettings): Promise<{
  sandboxRecord: SandboxRecord;
  commands: CommandRecord[];
}> {
  const storedSnapshot = getRestorableSnapshot(await loadStoredSnapshot());
  const timeout = getSandboxTimeoutMs(settings);
  let sandbox: Sandbox;
  let restoredSnapshot = storedSnapshot;
  let snapshotFallbackMessage: string | null = null;

  if (storedSnapshot) {
    try {
      sandbox = await Sandbox.create({
        source: {
          type: 'snapshot',
          snapshotId: storedSnapshot.snapshotId,
        },
        ports: [18789],
        timeout,
        env: sandboxEnvironment(settings),
      });
    } catch (error) {
      restoredSnapshot = null;
      snapshotFallbackMessage =
        redactSecrets(
          `Stored snapshot ${storedSnapshot.snapshotId} could not be restored. Falling back to a clean sandbox. ${error instanceof Error ? error.message : 'Unknown restore error.'}`,
          settings,
        ) ?? 'Stored snapshot could not be restored.';
      sandbox = await Sandbox.create({
        runtime: DEFAULT_RUNTIME,
        ports: [18789],
        timeout,
        env: sandboxEnvironment(settings),
      });
    }
  } else {
    sandbox = await Sandbox.create({
      runtime: DEFAULT_RUNTIME,
      ports: [18789],
      timeout,
      env: sandboxEnvironment(settings),
    });
  }

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

  if (snapshotFallbackMessage) {
    commands.push(
      createSystemCommand(
        sandbox.sandboxId,
        'system:restore-snapshot-fallback',
        snapshotFallbackMessage,
      ),
    );
  }

  if (!restoredSnapshot) {
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
      return {
        sandboxRecord: createSandboxRecord(sandbox, {
          status: 'error',
          sourceSnapshotId: null,
          openClawVersion: null,
          errorMessage:
            installResult.stderr || installResult.stdout || 'OpenClaw installation failed.',
          lastSnapshotAt: storedSnapshot?.updatedAt ?? null,
        }),
        commands,
      };
    }
  } else {
    commands.push(
      createSystemCommand(
        sandbox.sandboxId,
        'system:restore-snapshot',
        `Restored sandbox from snapshot ${restoredSnapshot.snapshotId}.`,
      ),
    );
  }

  const gatewayCommand = await runTrackedCommand(sandbox, {
    cmd: 'bash',
    args: [
      '-lc',
      [
        `export OPENCLAW_CONFIG_PATH=${OPENCLAW_ROOT}/openclaw.json`,
        `export OPENCLAW_STATE_DIR=${OPENCLAW_ROOT}/state`,
        `openclaw gateway > "${GATEWAY_LOG_PATH}" 2>&1`,
      ].join(' && '),
    ],
    detached: true,
    settings,
  });
  commands.push(gatewayCommand);

  const gatewayDiagnostics = await waitForGatewayReady(sandbox, settings);
  if (gatewayDiagnostics) {
    commands.push(gatewayDiagnostics);

    return {
      sandboxRecord: createSandboxRecord(sandbox, {
        status: 'error',
        sourceSnapshotId: sandbox.sourceSnapshotId ?? restoredSnapshot?.snapshotId ?? null,
        openClawVersion: null,
        errorMessage:
          gatewayDiagnostics.stderr ||
          gatewayDiagnostics.stdout ||
          'OpenClaw gateway did not become ready before timeout.',
        lastSnapshotAt: restoredSnapshot?.updatedAt ?? null,
      }),
      commands,
    };
  }

  const version = await sandbox.runCommand('bash', ['-lc', 'openclaw --version']);
  const startedAt = Date.now();

  return {
    sandboxRecord: {
      ...createSandboxRecord(sandbox, {
        status: 'running',
        sourceSnapshotId: sandbox.sourceSnapshotId ?? restoredSnapshot?.snapshotId ?? null,
        openClawVersion: (await version.stdout()).trim() || null,
        errorMessage: null,
        lastSnapshotAt: restoredSnapshot?.updatedAt ?? null,
        startedAt,
      }),
      expiresAt: getExpiresAt(startedAt, settings),
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
  try {
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
        status: sandbox.status === 'running' ? 'running' : 'stopped',
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
  } catch (error) {
    if (!isSandboxGoneError(error)) {
      throw error;
    }

    const storedSnapshot = await loadStoredSnapshot();

    return {
      sandbox: {
        sandboxId,
        status: 'stopped',
        runtime: DEFAULT_RUNTIME,
        previewUrl: null,
        gatewayUrl: null,
        sourceSnapshotId: storedSnapshot?.snapshotId ?? null,
        activeCpuUsageMs: null,
        networkBytes: null,
        openClawVersion: null,
        errorMessage:
          'Sandbox is no longer reachable. Start a new sandbox or restore from the latest snapshot.',
        startedAt: Date.now(),
        expiresAt: null,
        lastSnapshotAt: storedSnapshot?.updatedAt ?? null,
        updatedAt: Date.now(),
      },
      sessions: [],
      commands: [
        createSystemCommand(
          sandboxId,
          'system:sandbox-unreachable',
          'Sandbox returned 410 Gone during sync and was marked as stopped.',
        ),
      ],
    };
  }
}

export async function snapshotOpenClawSandbox(sandboxId: string): Promise<CommandRecord> {
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
  try {
    const sandbox = await Sandbox.get({ sandboxId });
    await sandbox.stop();
  } catch (error) {
    if (isSandboxGoneError(error)) {
      return;
    }

    throw error;
  }
}

export async function reconcileOpenClawSandboxLifecycle() {
  if (lifecycleReconcile) {
    return await lifecycleReconcile;
  }

  lifecycleReconcile = (async () => {
    try {
      const state = await readDashboardState();

      if (!state.settings.autoRecreateSandbox) {
        return {
          status: 'skipped',
          reason: 'auto-recreate-disabled',
          sandboxId: state.sandbox?.sandboxId ?? null,
          previousSandboxId: state.sandbox?.sandboxId ?? null,
        } satisfies LifecycleReconcileResult;
      }

      const previousSandboxId = state.sandbox?.sandboxId ?? null;
      const previousSnapshot = await loadStoredSnapshot();
      const hasLiveSandbox = previousSandboxId
        ? await isOpenClawSandboxRunning(previousSandboxId)
        : false;

      if (hasLiveSandbox && state.sandbox) {
        const timeoutMs = getSandboxTimeoutMs(state.settings);
        const rolloverAt = state.sandbox.startedAt + timeoutMs - getRolloverWindowMs(timeoutMs);

        if (Date.now() < rolloverAt) {
          return {
            status: 'skipped',
            reason: 'rollover-not-due',
            sandboxId: state.sandbox.sandboxId,
            previousSandboxId: state.sandbox.sandboxId,
          } satisfies LifecycleReconcileResult;
        }

        let snapshotCommand: CommandRecord | null = null;

        try {
          snapshotCommand = await snapshotOpenClawSandbox(state.sandbox.sandboxId);
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

        if (sandboxRecord.sandboxId !== state.sandbox.sandboxId) {
          await stopOpenClawSandbox(state.sandbox.sandboxId).catch(() => {});
        }

        if (previousSnapshot && previousSnapshot.snapshotId !== sandboxRecord.sourceSnapshotId) {
          await deleteRemoteSnapshot(previousSnapshot.snapshotId);
        }

        return {
          status: 'recreated',
          reason: 'rollover-complete',
          sandboxId: sandboxRecord.sandboxId,
          previousSandboxId: state.sandbox.sandboxId,
        } satisfies LifecycleReconcileResult;
      }

      const { sandboxRecord, commands } = await createOpenClawSandbox(state.settings);

      await updateDashboardState((current) => ({
        ...current,
        sandbox: sandboxRecord,
        sessions: [],
        commands: commands.reduce(
          (items, command) => appendCommand(items, command),
          current.commands,
        ),
      }));

      if (previousSandboxId && sandboxRecord.sandboxId !== previousSandboxId) {
        await stopOpenClawSandbox(previousSandboxId).catch(() => {});
      }

      if (previousSnapshot && previousSnapshot.snapshotId !== sandboxRecord.sourceSnapshotId) {
        await deleteRemoteSnapshot(previousSnapshot.snapshotId);
      }

      return {
        status: 'recreated',
        reason: sandboxRecord.sourceSnapshotId ? 'recovery-from-snapshot' : 'recovery-clean-start',
        sandboxId: sandboxRecord.sandboxId,
        previousSandboxId,
      } satisfies LifecycleReconcileResult;
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
      throw error;
    }
  })().finally(() => {
    lifecycleReconcile = null;
  });

  return await lifecycleReconcile;
}
