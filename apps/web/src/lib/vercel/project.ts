import 'server-only';

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type LocalVercelProjectMetadata = {
  projectId: string;
  teamId: string;
  projectName: string;
};

let cachedProjectMetadata: LocalVercelProjectMetadata | null | undefined;

function findProjectConfigPath() {
  let currentDir = process.cwd();

  while (true) {
    const candidate = join(currentDir, '.vercel', 'project.json');
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

export function readLocalVercelProjectMetadata(): LocalVercelProjectMetadata | null {
  if (cachedProjectMetadata !== undefined) {
    return cachedProjectMetadata;
  }

  const configPath = findProjectConfigPath();
  if (!configPath) {
    cachedProjectMetadata = null;
    return cachedProjectMetadata;
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as {
      orgId?: string;
      projectId?: string;
      projectName?: string;
    };

    if (!parsed.projectId || !parsed.orgId || !parsed.projectName) {
      cachedProjectMetadata = null;
      return cachedProjectMetadata;
    }

    cachedProjectMetadata = {
      projectId: parsed.projectId,
      teamId: parsed.orgId,
      projectName: parsed.projectName,
    };
    return cachedProjectMetadata;
  } catch {
    cachedProjectMetadata = null;
    return cachedProjectMetadata;
  }
}

export function resolveVercelProjectId() {
  return process.env.VERCEL_PROJECT_ID || readLocalVercelProjectMetadata()?.projectId || '';
}

export function resolveVercelTeamId() {
  return process.env.VERCEL_TEAM_ID || readLocalVercelProjectMetadata()?.teamId || '';
}
