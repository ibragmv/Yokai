import 'server-only';

import { Snapshot } from '@vercel/sandbox';
import postgres, { type Sql } from 'postgres';

import type { DashboardSettings } from '@/lib/types';

const SNAPSHOT_TABLE = 'openclaw_snapshots';
const SNAPSHOT_KEY = 'primary';

export type StoredOpenClawSnapshot = {
  snapshotId: string;
  sourceSandboxId: string;
  createdAt: number;
  expiresAt: number | null;
  updatedAt: number;
};

type SnapshotRow = {
  snapshot_id: string;
  source_sandbox_id: string;
  created_at: number;
  expires_at: number | null;
  updated_at: number;
};

function getDatabaseUrl(settings: DashboardSettings) {
  return settings.persistenceDatabaseUrl.trim();
}

function createClient(databaseUrl: string) {
  return postgres(databaseUrl, {
    idle_timeout: 5,
    max: 1,
    prepare: false,
    ssl: 'require',
  });
}

function isPersistenceConnectionError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return [
    'ENOTFOUND',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'Connection terminated unexpectedly',
  ].some((token) => error.message.includes(token));
}

async function ensureSnapshotTable(sql: Sql) {
  await sql.unsafe(`
    create table if not exists ${SNAPSHOT_TABLE} (
      key text primary key,
      snapshot_id text not null,
      source_sandbox_id text not null,
      created_at bigint not null,
      expires_at bigint,
      updated_at bigint not null
    )
  `);
}

function mapSnapshotRow(row: SnapshotRow): StoredOpenClawSnapshot {
  return {
    snapshotId: row.snapshot_id,
    sourceSandboxId: row.source_sandbox_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  };
}

async function withSnapshotStore<T>(
  settings: DashboardSettings,
  handler: (sql: Sql) => Promise<T>,
): Promise<T | null> {
  const databaseUrl = getDatabaseUrl(settings);
  if (!databaseUrl) {
    return null;
  }

  const sql = createClient(databaseUrl);

  try {
    await ensureSnapshotTable(sql);
    return await handler(sql);
  } catch (error) {
    if (isPersistenceConnectionError(error)) {
      return null;
    }

    throw error;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function loadStoredSnapshot(
  settings: DashboardSettings,
): Promise<StoredOpenClawSnapshot | null> {
  return withSnapshotStore(settings, async (sql) => {
    const rows = await sql<SnapshotRow[]>`
      select snapshot_id, source_sandbox_id, created_at, expires_at, updated_at
      from ${sql(SNAPSHOT_TABLE)}
      where key = ${SNAPSHOT_KEY}
      limit 1
    `;

    const row = rows[0];
    return row ? mapSnapshotRow(row) : null;
  });
}

export async function saveStoredSnapshot(
  settings: DashboardSettings,
  snapshot: Snapshot,
): Promise<StoredOpenClawSnapshot | null> {
  return withSnapshotStore(settings, async (sql) => {
    const now = Date.now();
    const expiresAt = snapshot.expiresAt?.getTime() ?? null;

    const rows = await sql<SnapshotRow[]>`
      insert into ${sql(SNAPSHOT_TABLE)} (
        key,
        snapshot_id,
        source_sandbox_id,
        created_at,
        expires_at,
        updated_at
      )
      values (
        ${SNAPSHOT_KEY},
        ${snapshot.snapshotId},
        ${snapshot.sourceSandboxId},
        ${snapshot.createdAt.getTime()},
        ${expiresAt},
        ${now}
      )
      on conflict (key) do update
      set snapshot_id = excluded.snapshot_id,
          source_sandbox_id = excluded.source_sandbox_id,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      returning snapshot_id, source_sandbox_id, created_at, expires_at, updated_at
    `;

    return mapSnapshotRow(rows[0]);
  });
}

export async function deleteStoredSnapshot(settings: DashboardSettings) {
  await withSnapshotStore(settings, async (sql) => {
    await sql`
      delete from ${sql(SNAPSHOT_TABLE)}
      where key = ${SNAPSHOT_KEY}
    `;
  });
}

export async function deleteRemoteSnapshot(snapshotId: string | null | undefined) {
  if (!snapshotId) {
    return;
  }

  try {
    const snapshot = await Snapshot.get({ snapshotId });
    await snapshot.delete();
  } catch {}
}
