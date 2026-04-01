import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rootDir = process.cwd();
const envPath = join(rootDir, '.env');
const envLocalPath = join(rootDir, '.env.local');
const convexBinPath = join(rootDir, 'node_modules', '.bin', 'convex');

type Target = 'dev' | 'prod';
type Mode = 'deploy' | 'logs' | 'sync' | 'watch';

const [, , targetArg, modeArg] = process.argv;

if (!isTarget(targetArg) || !isMode(modeArg)) {
  console.error('Usage: bun run scripts/convex-command.ts <dev|prod> <sync|watch|deploy|logs>');
  process.exit(1);
}

await main(targetArg, modeArg);

function isTarget(value: string | undefined): value is Target {
  return value === 'dev' || value === 'prod';
}

function isMode(value: string | undefined): value is Mode {
  return value === 'deploy' || value === 'logs' || value === 'sync' || value === 'watch';
}

function parseEnvFile(filePath: string) {
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

function buildTargetEnv(target: Target) {
  const env = parseEnvFile(envPath);
  const suffix = target.toUpperCase();
  const deployment = env[`CONVEX_DEPLOYMENT_${suffix}`];
  const convexUrl = env[`NEXT_PUBLIC_CONVEX_URL_${suffix}`];
  const siteUrl = env[`NEXT_PUBLIC_CONVEX_SITE_URL_${suffix}`];

  if (!deployment || !convexUrl || !siteUrl) {
    throw new Error(`Missing Convex ${target} target variables in .env`);
  }

  return {
    ...process.env,
    ...env,
    CONVEX_DEPLOYMENT: deployment,
    NEXT_PUBLIC_CONVEX_URL: convexUrl,
    NEXT_PUBLIC_CONVEX_SITE_URL: siteUrl,
  };
}

function updateOrAppendEnvValue(content: string, key: string, value: string) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');

  if (pattern.test(content)) {
    return content.replace(pattern, `${key}=${value}`);
  }

  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  return `${normalized}${key}=${value}\n`;
}

function cleanupEnvLocal(target: Target) {
  if (!existsSync(envLocalPath)) {
    return;
  }

  if (target === 'dev') {
    const envLocal = parseEnvFile(envLocalPath);
    let envContent = readFileSync(envPath, 'utf8');

    const deployment = envLocal.CONVEX_DEPLOYMENT;
    const convexUrl = envLocal.NEXT_PUBLIC_CONVEX_URL;
    const siteUrl = envLocal.NEXT_PUBLIC_CONVEX_SITE_URL;

    if (deployment) {
      envContent = updateOrAppendEnvValue(envContent, 'CONVEX_DEPLOYMENT_DEV', deployment);
    }

    if (convexUrl) {
      envContent = updateOrAppendEnvValue(envContent, 'NEXT_PUBLIC_CONVEX_URL_DEV', convexUrl);
    }

    if (siteUrl) {
      envContent = updateOrAppendEnvValue(envContent, 'NEXT_PUBLIC_CONVEX_SITE_URL_DEV', siteUrl);
    }

    writeFileSync(envPath, envContent);
  }

  unlinkSync(envLocalPath);
}

async function runConvex(target: Target, mode: Mode) {
  const env = buildTargetEnv(target);
  const tempDir = mkdtempSync(join(tmpdir(), 'yokai-convex-'));
  const tempEnvPath = join(tempDir, '.env.target');
  writeFileSync(
    tempEnvPath,
    [
      `CONVEX_DEPLOYMENT=${env.CONVEX_DEPLOYMENT ?? ''}`,
      `NEXT_PUBLIC_CONVEX_URL=${env.NEXT_PUBLIC_CONVEX_URL ?? ''}`,
      `NEXT_PUBLIC_CONVEX_SITE_URL=${env.NEXT_PUBLIC_CONVEX_SITE_URL ?? ''}`,
    ].join('\n'),
  );

  const args = getConvexArgs(target, mode, tempEnvPath);
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(convexBinPath, args, {
      cwd: rootDir,
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  }).finally(() => {
    cleanupEnvLocal(target);
    rmSync(tempDir, { recursive: true, force: true });
  });

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

function getConvexArgs(target: Target, mode: Mode, tempEnvPath: string) {
  if (mode === 'watch') {
    return ['dev', '--env-file', tempEnvPath];
  }

  if (mode === 'sync' || (target === 'dev' && mode === 'deploy')) {
    return ['dev', '--once', '--env-file', tempEnvPath];
  }

  if (mode === 'deploy') {
    return ['deploy', '--env-file', tempEnvPath];
  }

  if (mode === 'logs') {
    return target === 'prod' ? ['logs', '--prod'] : ['logs'];
  }

  throw new Error(`Unsupported Convex mode: ${mode}`);
}

async function main(target: Target, mode: Mode) {
  await runConvex(target, mode);
}
