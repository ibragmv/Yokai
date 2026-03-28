import 'server-only';

export function resolveVercelProjectId() {
  return process.env.VERCEL_PROJECT_ID?.trim() || '';
}

export function resolveVercelTeamId() {
  return process.env.VERCEL_TEAM_ID?.trim() || '';
}
