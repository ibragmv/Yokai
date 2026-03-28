import 'server-only';

import { Sandbox } from '@vercel/sandbox';

import { buildOpenClawConfig, sandboxEnvironment } from '@/lib/openclaw/config';
import { redactSecrets } from '@/lib/security/redaction';
import type { CommandRecord, DashboardSettings, SandboxRecord, SessionRecord } from '@/lib/types';
import { truncate } from '@/lib/utils';

const OPENCLAW_ROOT = '/vercel/sandbox/openclaw';

export async function createOpenClawSandbox(settings: DashboardSettings): Promise<{
  sandboxRecord: SandboxRecord;
  installCommand: CommandRecord;
}> {
  const sandbox = await Sandbox.create({
    runtime: 'node24',
    ports: [18789],
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

  if (installResult.status === 'failed') {
    throw new Error(installResult.stderr || installResult.stdout || 'OpenClaw installation failed');
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

  return {
    sandboxRecord: {
      sandboxId: sandbox.sandboxId,
      status: 'running',
      runtime: 'node24',
      previewUrl,
      gatewayUrl: previewUrl,
      activeCpuUsageMs: sandbox.activeCpuUsageMs ?? null,
      networkBytes:
        (sandbox as Sandbox & { networkUsage?: { totalBytes?: number } }).networkUsage
          ?.totalBytes ?? null,
      openClawVersion: (await version.stdout()).trim() || null,
      errorMessage: null,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    },
    installCommand: installResult,
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

  return {
    sandbox: {
      sandboxId,
      status: sandbox.status === 'running' ? 'running' : 'error',
      runtime: 'node24',
      previewUrl: sandbox.domain(18789),
      gatewayUrl: sandbox.domain(18789),
      activeCpuUsageMs: sandbox.activeCpuUsageMs ?? null,
      networkBytes:
        (sandbox as Sandbox & { networkUsage?: { totalBytes?: number } }).networkUsage
          ?.totalBytes ?? null,
      openClawVersion: null,
      errorMessage: null,
      startedAt: sandbox.createdAt.getTime(),
      updatedAt: Date.now(),
    },
    sessions,
    commands: [sessionsCommand],
  };
}

export async function stopOpenClawSandbox(sandboxId: string) {
  const sandbox = await Sandbox.get({ sandboxId });
  await sandbox.stop();
}
