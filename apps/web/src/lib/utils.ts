export function splitCsv(input: string): string[] {
  return input
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function truncate(value: string, limit = 2400): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}\n…`;
}

export function stripAnsi(value: string): string {
  const escapeChar = String.fromCharCode(27);
  return value.replace(
    // Remove terminal color and cursor control sequences from captured command output.
    new RegExp(`${escapeChar}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`, 'g'),
    '',
  );
}

export function formatRelativeDate(timestamp: number | null): string {
  if (!timestamp) {
    return 'Never';
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

export function maskSecret(secret: string): string {
  if (!secret) {
    return '';
  }

  if (secret.length <= 8) {
    return '••••••••';
  }

  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}
