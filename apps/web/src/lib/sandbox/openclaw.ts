import 'server-only';

import { Sandbox } from '@vercel/sandbox';

import { buildOpenClawConfig, sandboxEnvironment } from '@/lib/openclaw/config';
import {
  deleteRemoteSnapshot,
  deleteStoredBackupAsset,
  downloadStoredBackupAsset,
  loadStoredSnapshot,
  saveStoredSnapshot,
  uploadStoredBackupBundle,
  uploadStoredBackupSessions,
} from '@/lib/persistence/snapshots';
import { redactSecrets } from '@/lib/security/redaction';
import {
  acquireSandboxOperationLease,
  appendCommand,
  appendUsage,
  readDashboardState,
  releaseSandboxOperationLease,
  updateDashboardState,
} from '@/lib/store';
import type {
  CommandRecord,
  DashboardSettings,
  SandboxOperationType,
  SandboxRecord,
  SessionRecord,
  StoredSnapshotRecord,
} from '@/lib/types';
import { stripAnsi, truncate } from '@/lib/utils';

const OPENCLAW_ROOT = '/vercel/sandbox/openclaw';
const OPENCLAW_STATE_ROOT = `${OPENCLAW_ROOT}/state`;
const OPENCLAW_WORKSPACE_ROOT = `${OPENCLAW_ROOT}/workspace`;
const OPENCLAW_STATE_ARCHIVE_ROOT = OPENCLAW_ROOT.slice(1);
const OPENCLAW_STATE_ARCHIVE_DIR = `${OPENCLAW_STATE_ARCHIVE_ROOT}/state`;
const OPENCLAW_WORKSPACE_ARCHIVE_DIR = `${OPENCLAW_STATE_ARCHIVE_ROOT}/workspace`;
const GATEWAY_LOG_PATH = `${OPENCLAW_ROOT}/state/gateway.log`;
const HANDOFF_ROOT = `${OPENCLAW_ROOT}/handoff`;
const HANDOFF_BUNDLE_PATH = `${HANDOFF_ROOT}/openclaw-state.tgz`;
const HANDOFF_SESSIONS_PATH = `${HANDOFF_ROOT}/sessions.json`;
const DEFAULT_RUNTIME = 'node24';
const GATEWAY_READY_TIMEOUT_MS = 20_000;
const GATEWAY_READY_POLL_MS = 1_000;
const SNAPSHOT_EXPIRATION_MS = 0;
const SESSION_SYNC_TIMEOUT_SECONDS = 20;
const OPERATION_LEASE_TTLS_MS: Record<SandboxOperationType, number> = {
  start: 10 * 60_000,
  stop: 4 * 60_000,
  sync: 90_000,
  reconcile: 10 * 60_000,
};

export type LifecycleReconcileResult = {
  status: 'skipped' | 'recreated';
  reason:
    | 'sandbox-missing'
    | 'sandbox-not-running'
    | 'auto-recreate-disabled'
    | 'operation-locked'
    | 'rollover-not-due'
    | 'rollover-complete'
    | 'recovery-from-backup'
    | 'recovery-clean-start';
  sandboxId: string | null;
  previousSandboxId: string | null;
};

type BootSandboxResult = {
  sandbox: Sandbox;
  sandboxRecord: SandboxRecord;
  sessions: SessionRecord[];
  commands: CommandRecord[];
};

type SnapshotRestoreMode = 'backup' | 'clean';

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
  return Math.min(300_000, Math.max(90_000, Math.floor(timeoutMs * 0.3)));
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

async function withSandboxOperationLease<T>(
  type: SandboxOperationType,
  onLocked: () => Promise<T>,
  task: () => Promise<T>,
) {
  const lease = await acquireSandboxOperationLease(type, OPERATION_LEASE_TTLS_MS[type]);
  if (!lease) {
    return await onLocked();
  }

  try {
    return await task();
  } finally {
    await releaseSandboxOperationLease(lease.owner).catch(() => {});
  }
}

function isSandboxGoneError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    /\b410\b/.test(message) || /\bgone\b/i.test(message) || /status code .* not ok/i.test(message)
  );
}

function hasStoredBackup(snapshot: StoredSnapshotRecord | null) {
  return Boolean(snapshot?.backupBundleStorageId?.trim());
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
  const gatewayUrl = sandbox.domain(18789);

  return {
    sandboxId: sandbox.sandboxId,
    status: input.status,
    runtime: DEFAULT_RUNTIME,
    gatewayUrl,
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

async function primeOpenClawWorkspace(sandbox: Sandbox, settings: DashboardSettings) {
  await sandbox.runCommand({
    cmd: 'bash',
    args: [
      '-lc',
      [
        `mkdir -p "${OPENCLAW_ROOT}" "${OPENCLAW_STATE_ROOT}" "${OPENCLAW_WORKSPACE_ROOT}" "${HANDOFF_ROOT}"`,
        `rm -f "${GATEWAY_LOG_PATH}"`,
        `find "${OPENCLAW_ROOT}/state" -maxdepth 1 \\( -name "*.pid" -o -name "*.lock" -o -name "*.sock" \\) -delete 2>/dev/null || true`,
      ].join('\n'),
    ],
  });

  await sandbox.writeFiles([
    {
      path: `${OPENCLAW_ROOT}/openclaw.json`,
      content: Buffer.from(buildOpenClawConfig(settings)),
    },
  ]);
}

async function restoreOpenClawHandoffBundle(
  sandbox: Sandbox,
  settings: DashboardSettings,
): Promise<CommandRecord> {
  return await runTrackedCommand(sandbox, {
    cmd: 'bash',
    args: [
      '-lc',
      [
        `if [ ! -f "${HANDOFF_BUNDLE_PATH}" ]; then`,
        `  echo "No OpenClaw handoff bundle found at ${HANDOFF_BUNDLE_PATH}."`,
        '  exit 0',
        'fi',
        'mkdir -p "$HOME/.openclaw"',
        `tar -xzf "${HANDOFF_BUNDLE_PATH}" -C /`,
        'sync || true',
        `echo "Restored OpenClaw handoff bundle from ${HANDOFF_BUNDLE_PATH}."`,
      ].join('\n'),
    ],
    settings,
  });
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

async function createSandboxInstance(
  settings: DashboardSettings,
  restoreMode: SnapshotRestoreMode,
) {
  const timeout = getSandboxTimeoutMs(settings);

  return await Sandbox.create({
    runtime: DEFAULT_RUNTIME,
    ports: [18789],
    timeout,
    env: sandboxEnvironment(settings),
  });
}

async function bootOpenClawSandbox(
  settings: DashboardSettings,
  restoredSnapshot: StoredSnapshotRecord | null,
  restoreMode: SnapshotRestoreMode,
  inheritedCommands: CommandRecord[] = [],
): Promise<BootSandboxResult> {
  const sandbox = await createSandboxInstance(settings, restoreMode);
  try {
    await primeOpenClawWorkspace(sandbox, settings);

    const commands = [...inheritedCommands];
    let sessions: SessionRecord[] = [];

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
        sandbox,
        sandboxRecord: createSandboxRecord(sandbox, {
          status: 'error',
          sourceSnapshotId: restoredSnapshot?.snapshotId ?? null,
          openClawVersion: null,
          errorMessage:
            installResult.stderr || installResult.stdout || 'OpenClaw installation failed.',
          lastSnapshotAt: null,
        }),
        sessions,
        commands,
      };
    }

    if (restoreMode === 'backup' && restoredSnapshot?.backupBundleStorageId) {
      const bundle = await downloadStoredBackupAsset(restoredSnapshot.backupBundleStorageId);

      if (!bundle) {
        return {
          sandbox,
          sandboxRecord: createSandboxRecord(sandbox, {
            status: 'error',
            sourceSnapshotId: restoredSnapshot.snapshotId,
            openClawVersion: null,
            errorMessage: 'Convex backup bundle is missing, so the sandbox could not be restored.',
            lastSnapshotAt: restoredSnapshot.updatedAt,
          }),
          sessions,
          commands,
        };
      }

      await sandbox.writeFiles([
        {
          path: HANDOFF_BUNDLE_PATH,
          content: bundle,
        },
      ]);

      const exportedSessions = await downloadStoredBackupAsset(
        restoredSnapshot.backupSessionsStorageId,
      ).catch(() => null);

      if (exportedSessions) {
        await sandbox.writeFiles([
          {
            path: HANDOFF_SESSIONS_PATH,
            content: exportedSessions,
          },
        ]);
      }

      commands.push(
        createSystemCommand(
          sandbox.sandboxId,
          'system:restore-convex-backup',
          `Restored OpenClaw handoff bundle from Convex backup for snapshot ${restoredSnapshot.snapshotId}.`,
        ),
      );
      commands.push(await restoreOpenClawHandoffBundle(sandbox, settings));
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
        sandbox,
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
        sessions,
        commands,
      };
    }

    const version = await sandbox.runCommand('bash', ['-lc', 'openclaw --version']);
    const startedAt = Date.now();
    const sandboxRecord = {
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
    } satisfies SandboxRecord;

    if (restoredSnapshot) {
      try {
        const restoredSync = await syncOpenClawSessions(sandbox.sandboxId, settings);
        sessions = restoredSync.sessions;
        commands.push(...restoredSync.commands);

        if (
          typeof restoredSnapshot.sessionCount === 'number' &&
          restoredSnapshot.sessionCount > 0 &&
          restoredSync.sessions.length === 0
        ) {
          commands.push(
            createSystemCommand(
              sandbox.sandboxId,
              'system:restore-session-mismatch',
              `Snapshot ${restoredSnapshot.snapshotId} expected ${restoredSnapshot.sessionCount} session(s), but restore reported none.`,
            ),
          );
        }
      } catch (error) {
        commands.push(
          createSystemCommand(
            sandbox.sandboxId,
            'system:restore-session-sync-failed',
            redactSecrets(
              error instanceof Error
                ? error.message
                : 'Failed to verify restored OpenClaw sessions.',
              settings,
            ) ?? 'Failed to verify restored OpenClaw sessions.',
          ),
        );
      }
    }

    return {
      sandbox,
      sandboxRecord,
      sessions,
      commands,
    };
  } catch (error) {
    await stopOpenClawSandbox(sandbox.sandboxId).catch(() => {});
    throw error;
  }
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
  sessions: SessionRecord[];
  commands: CommandRecord[];
}> {
  const currentState = await readDashboardState();
  const currentSandbox = currentState.sandbox;

  if (currentSandbox && (await isOpenClawSandboxRunning(currentSandbox.sandboxId))) {
    const synced = await syncOpenClawSessions(currentSandbox.sandboxId, settings).catch(() => null);

    return {
      sandboxRecord: synced
        ? {
            ...currentSandbox,
            ...synced.sandbox,
            openClawVersion: currentSandbox.openClawVersion ?? synced.sandbox.openClawVersion,
            errorMessage: null,
            updatedAt: Date.now(),
          }
        : {
            ...currentSandbox,
            status: 'running',
            errorMessage: null,
            updatedAt: Date.now(),
          },
      sessions: synced?.sessions ?? currentState.sessions,
      commands: synced?.commands ?? [],
    };
  }

  const snapshotRecord = await loadStoredSnapshot();
  const storedBackupSnapshot =
    snapshotRecord && hasStoredBackup(snapshotRecord) ? snapshotRecord : null;

  if (storedBackupSnapshot) {
    try {
      const restoredBoot = await bootOpenClawSandbox(settings, storedBackupSnapshot, 'backup');

      if (restoredBoot.sandboxRecord.status === 'running') {
        return {
          sandboxRecord: restoredBoot.sandboxRecord,
          sessions: restoredBoot.sessions,
          commands: restoredBoot.commands,
        };
      }

      await stopOpenClawSandbox(restoredBoot.sandbox.sandboxId).catch(() => {});
      return {
        sandboxRecord: {
          ...restoredBoot.sandboxRecord,
          status: 'error',
          errorMessage:
            restoredBoot.sandboxRecord.errorMessage ??
            `Convex backup ${storedBackupSnapshot.snapshotId} was preserved, but restore did not produce a healthy sandbox.`,
          updatedAt: Date.now(),
        },
        sessions: restoredBoot.sessions,
        commands: [
          ...restoredBoot.commands,
          createSystemCommand(
            storedBackupSnapshot.sourceSandboxId || storedBackupSnapshot.snapshotId,
            'system:convex-backup-restore-failed',
            `Convex backup ${storedBackupSnapshot.snapshotId} was preserved in Convex, but restore produced an unhealthy sandbox. Clean boot was intentionally skipped.`,
          ),
        ],
      };
    } catch (error) {
      throw new Error(
        redactSecrets(
          `Convex backup restore failed for snapshot ${storedBackupSnapshot.snapshotId}. The stored snapshot was preserved and clean boot was intentionally skipped. ${error instanceof Error ? error.message : 'Unknown restore error.'}`,
          settings,
        ) ??
          `Convex backup restore failed for snapshot ${storedBackupSnapshot.snapshotId}. The stored snapshot was preserved and clean boot was intentionally skipped.`,
      );
    }
  }

  if (snapshotRecord) {
    throw new Error(
      `Stored snapshot ${snapshotRecord.snapshotId} is present in Convex but has no backup bundle. Restore only runs from Convex backup, so clean boot was intentionally skipped.`,
    );
  }

  const cleanBoot = await bootOpenClawSandbox(settings, null, 'clean');
  return {
    sandboxRecord: cleanBoot.sandboxRecord,
    sessions: cleanBoot.sessions,
    commands: cleanBoot.commands,
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
  const stdout = truncate(stripAnsi(await result.stdout()));
  const stderr = truncate(stripAnsi(await result.stderr()));

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
        `timeout ${SESSION_SYNC_TIMEOUT_SECONDS}s openclaw sessions --all-agents --json`,
      ].join(' && '),
    ];
    const sessionsResult = await sandbox.runCommand({
      cmd: 'bash',
      args,
      cwd: OPENCLAW_ROOT,
    });
    const rawStdout = stripAnsi(await sessionsResult.stdout());
    const rawStderr = stripAnsi(await sessionsResult.stderr());
    const timedOut = sessionsResult.exitCode === 124;
    const fallbackError =
      rawStderr ||
      rawStdout ||
      (timedOut
        ? `openclaw sessions timed out after ${SESSION_SYNC_TIMEOUT_SECONDS}s.`
        : `openclaw sessions exited with code ${sessionsResult.exitCode}.`);
    const sessionsCommand: CommandRecord = {
      cmdId: sessionsResult.cmdId,
      sandboxId,
      command: 'bash',
      args,
      status: sessionsResult.exitCode === 0 ? 'succeeded' : 'failed',
      exitCode: sessionsResult.exitCode,
      stdout: redactSecrets(truncate(rawStdout), settings) || null,
      stderr:
        redactSecrets(truncate(rawStderr || (timedOut ? fallbackError : '')), settings) || null,
      startedAt,
      finishedAt: Date.now(),
    };

    if (sessionsResult.exitCode !== 0) {
      throw new Error(
        redactSecrets(truncate(fallbackError), settings) ?? 'Failed to sync sessions.',
      );
    }

    let parsed: { sessions?: Record<string, unknown>[] };
    const trimmedStdout = rawStdout.trim();

    try {
      parsed = trimmedStdout
        ? (JSON.parse(trimmedStdout) as { sessions?: Record<string, unknown>[] })
        : {};
    } catch {
      const jsonStart = trimmedStdout.indexOf('{');
      const jsonEnd = trimmedStdout.lastIndexOf('}');

      if (jsonStart < 0 || jsonEnd <= jsonStart) {
        throw new Error('OpenClaw returned invalid JSON for session sync.');
      }

      try {
        parsed = JSON.parse(trimmedStdout.slice(jsonStart, jsonEnd + 1)) as {
          sessions?: Record<string, unknown>[];
        };
      } catch {
        throw new Error('OpenClaw returned invalid JSON for session sync.');
      }
    }

    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.map((session) => ({
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
        runtime: DEFAULT_RUNTIME,
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

export async function snapshotOpenClawSandbox(
  sandboxId: string,
  settings: DashboardSettings,
): Promise<CommandRecord> {
  const previousSnapshot = await loadStoredSnapshot();
  const sandbox = await Sandbox.get({ sandboxId });
  const startedAt = Date.now();
  let sessionCount: number | null = null;
  let backupBundleStorageId: StoredSnapshotRecord['backupBundleStorageId'] = null;
  let backupSessionsStorageId: StoredSnapshotRecord['backupSessionsStorageId'] = null;
  let backupBundleSize: number | null = null;
  let backupSessionsSize: number | null = null;

  try {
    const synced = await syncOpenClawSessions(sandboxId, settings);
    sessionCount = synced.sessions.length;
  } catch {}

  await sandbox.runCommand({
    cmd: 'bash',
    args: [
      '-lc',
      [
        `export OPENCLAW_CONFIG_PATH=${OPENCLAW_ROOT}/openclaw.json`,
        `export OPENCLAW_STATE_DIR=${OPENCLAW_ROOT}/state`,
        `mkdir -p "${HANDOFF_ROOT}"`,
        `timeout ${SESSION_SYNC_TIMEOUT_SECONDS}s openclaw sessions --all-agents --json > "${HANDOFF_SESSIONS_PATH}" 2>/dev/null || true`,
        'pkill -TERM -f "[o]penclaw gateway" || true',
        'for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "[o]penclaw gateway" >/dev/null || break; sleep 1; done',
        'paths=()',
        `[ -d "${OPENCLAW_STATE_ROOT}" ] && paths+=("${OPENCLAW_STATE_ARCHIVE_DIR}")`,
        `[ -d "${OPENCLAW_WORKSPACE_ROOT}" ] && paths+=("${OPENCLAW_WORKSPACE_ARCHIVE_DIR}")`,
        '[ -d "$HOME/.openclaw" ] && paths+=("${HOME#/}/.openclaw")',
        `if [ "\${#paths[@]}" -gt 0 ]; then tar -C / -czf "${HANDOFF_BUNDLE_PATH}" "\${paths[@]}"; else echo "No OpenClaw directories found to archive." > "${HANDOFF_SESSIONS_PATH}"; fi`,
        'sync || true',
      ].join(' && '),
    ],
    cwd: OPENCLAW_ROOT,
  });

  const backupBundle = await sandbox.readFileToBuffer({ path: HANDOFF_BUNDLE_PATH });
  if (!backupBundle) {
    throw new Error('OpenClaw handoff bundle was not created before snapshotting.');
  }

  backupBundleSize = backupBundle.byteLength;
  backupBundleStorageId = await uploadStoredBackupBundle(backupBundle);

  const backupSessions = await sandbox
    .readFileToBuffer({ path: HANDOFF_SESSIONS_PATH })
    .catch(() => null);
  if (backupSessions) {
    backupSessionsSize = backupSessions.byteLength;
    backupSessionsStorageId = await uploadStoredBackupSessions(backupSessions);
  }

  try {
    const snapshot = await sandbox.snapshot({ expiration: SNAPSHOT_EXPIRATION_MS });
    await saveStoredSnapshot(snapshot, {
      sessionCount,
      backupBundleStorageId,
      backupBundleSize,
      backupSessionsStorageId,
      backupSessionsSize,
    });

    if (previousSnapshot && previousSnapshot.snapshotId !== snapshot.snapshotId) {
      await Promise.allSettled([
        deleteRemoteSnapshot(previousSnapshot.snapshotId),
        deleteStoredBackupAsset(previousSnapshot.backupBundleStorageId),
        deleteStoredBackupAsset(previousSnapshot.backupSessionsStorageId),
      ]);
    }

    return createSystemCommand(
      sandboxId,
      'system:create-snapshot',
      `Stored snapshot ${snapshot.snapshotId} in Convex with a backup bundle.`,
      startedAt,
    );
  } catch (error) {
    await Promise.allSettled([
      deleteStoredBackupAsset(backupBundleStorageId),
      deleteStoredBackupAsset(backupSessionsStorageId),
    ]);
    throw error;
  }
}

export async function stopOpenClawSandbox(sandboxId: string) {
  try {
    const sandbox = await Sandbox.get({ sandboxId });
    if (
      sandbox.status === 'stopped' ||
      sandbox.status === 'stopping' ||
      sandbox.status === 'snapshotting' ||
      sandbox.status === 'failed'
    ) {
      return;
    }

    await sandbox.stop({ blocking: true });
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
    return await withSandboxOperationLease<LifecycleReconcileResult>(
      'reconcile',
      async () => {
        const state = await readDashboardState();

        return {
          status: 'skipped',
          reason: 'operation-locked',
          sandboxId: state.sandbox?.sandboxId ?? null,
          previousSandboxId: state.sandbox?.sandboxId ?? null,
        } satisfies LifecycleReconcileResult;
      },
      async () => {
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

            let preRolloverSync: Awaited<ReturnType<typeof syncOpenClawSessions>> | null = null;

            try {
              preRolloverSync = await syncOpenClawSessions(state.sandbox.sandboxId, state.settings);
            } catch {}

            let snapshotCommand: CommandRecord | null = null;

            try {
              snapshotCommand = await snapshotOpenClawSandbox(
                state.sandbox.sandboxId,
                state.settings,
              );
            } catch {}

            const { sandboxRecord, sessions, commands } = await createOpenClawSandbox(
              state.settings,
            );
            const nextCommands = [...(snapshotCommand ? [snapshotCommand] : []), ...commands];

            await updateDashboardState((current) => ({
              ...current,
              sandbox: {
                ...sandboxRecord,
                lastSnapshotAt: snapshotCommand?.finishedAt ?? sandboxRecord.lastSnapshotAt,
              },
              sessions,
              commands: [...(preRolloverSync?.commands ?? []), ...nextCommands].reduce(
                (items, command) => appendCommand(items, command),
                current.commands,
              ),
              usage: preRolloverSync
                ? appendUsage(current.usage, {
                    source: 'sandbox',
                    creditsRemaining: null,
                    creditsUsed: null,
                    cpuMs: preRolloverSync.sandbox.activeCpuUsageMs,
                    networkBytes: preRolloverSync.sandbox.networkBytes,
                    recordedAt: Date.now(),
                  })
                : current.usage,
            }));

            if (sandboxRecord.sandboxId !== state.sandbox.sandboxId) {
              await stopOpenClawSandbox(state.sandbox.sandboxId).catch(() => {});
            }

            return {
              status: 'recreated',
              reason: 'rollover-complete',
              sandboxId: sandboxRecord.sandboxId,
              previousSandboxId: state.sandbox.sandboxId,
            } satisfies LifecycleReconcileResult;
          }

          const { sandboxRecord, sessions, commands } = await createOpenClawSandbox(state.settings);

          await updateDashboardState((current) => ({
            ...current,
            sandbox: sandboxRecord,
            sessions,
            commands: commands.reduce(
              (items, command) => appendCommand(items, command),
              current.commands,
            ),
          }));

          if (previousSandboxId && sandboxRecord.sandboxId !== previousSandboxId) {
            await stopOpenClawSandbox(previousSandboxId).catch(() => {});
          }

          return {
            status: 'recreated',
            reason: sandboxRecord.sourceSnapshotId
              ? 'recovery-from-backup'
              : 'recovery-clean-start',
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
      },
    );
  })().finally(() => {
    lifecycleReconcile = null;
  });

  return await lifecycleReconcile;
}
