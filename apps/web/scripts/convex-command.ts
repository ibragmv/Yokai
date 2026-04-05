import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = process.cwd();
const envPath = join(rootDir, '.env');
const convexBinPath = join(rootDir, 'node_modules', '.bin', 'convex');

type Target = 'dev' | 'prod';
type Mode = 'deploy' | 'logs' | 'sync' | 'watch';

const command = parseCommand(process.argv.slice(2));

if (!command) {
  console.error('Usage: bun run scripts/convex-command.ts <sync|watch|deploy|logs> [dev|prod]');
  process.exit(1);
}

await main(command.mode, command.target);

function isTarget(value: string | undefined): value is Target {
  return value === 'dev' || value === 'prod';
}

function isMode(value: string | undefined): value is Mode {
  return value === 'deploy' || value === 'logs' || value === 'sync' || value === 'watch';
}

function parseCommand(args: string[]) {
  const [firstArg, secondArg] = args;

  if (isMode(firstArg)) {
    return isTarget(secondArg) || secondArg === undefined
      ? { mode: firstArg, target: secondArg }
      : null;
  }

  if (isTarget(firstArg) && isMode(secondArg)) {
    return { mode: secondArg, target: firstArg };
  }

  return null;
}

function parseEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return {};
  }

  const content = readFileSync(filePath, 'utf8');
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/\s+#.*$/, '');
    values[key] = value;
  }

  return values;
}

function requireEnvValue(env: Record<string, string | undefined>, key: string) {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable ${key} in .env or process.env`);
  }
  return value;
}

function buildRuntimeEnv(target?: Target) {
  const envFile = parseEnvFile(envPath);
  const runtimeEnv = { ...envFile, ...process.env };

  if (target) {
    const suffix = target.toUpperCase();
    runtimeEnv.CONVEX_DEPLOYMENT = requireEnvValue(runtimeEnv, `CONVEX_DEPLOYMENT_${suffix}`);
    runtimeEnv.NEXT_PUBLIC_CONVEX_URL = requireEnvValue(
      runtimeEnv,
      `NEXT_PUBLIC_CONVEX_URL_${suffix}`,
    );
    runtimeEnv.NEXT_PUBLIC_CONVEX_SITE_URL = requireEnvValue(
      runtimeEnv,
      `NEXT_PUBLIC_CONVEX_SITE_URL_${suffix}`,
    );
  }

  requireEnvValue(runtimeEnv, 'CONVEX_DEPLOYMENT');
  requireEnvValue(runtimeEnv, 'NEXT_PUBLIC_CONVEX_URL');
  requireEnvValue(runtimeEnv, 'NEXT_PUBLIC_CONVEX_SITE_URL');

  return runtimeEnv;
}

async function runConvex(mode: Mode, target?: Target) {
  const env = buildRuntimeEnv(target);
  const args = getConvexArgs(mode);
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(convexBinPath, args, {
      cwd: rootDir,
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

function getConvexArgs(mode: Mode) {
  if (mode === 'watch') {
    return ['dev'];
  }

  if (mode === 'sync') {
    return ['dev', '--once'];
  }

  if (mode === 'deploy') {
    return ['deploy'];
  }

  if (mode === 'logs') {
    return ['logs'];
  }

  throw new Error(`Unsupported Convex mode: ${mode}`);
}

async function main(mode: Mode, target?: Target) {
  await runConvex(mode, target);
}
