import 'server-only';

import { Snapshot } from '@vercel/sandbox';

import { fetchMutation, fetchQuery } from 'convex/nextjs';

import type { StoredSnapshotRecord } from '@/lib/types';
import { api } from '@convex/_generated/api';

const SNAPSHOT_KEY = 'primary';

function mapSnapshot(snapshot: Snapshot): StoredSnapshotRecord {
  return {
    snapshotId: snapshot.snapshotId,
    sourceSandboxId: snapshot.sourceSandboxId,
    createdAt: snapshot.createdAt.getTime(),
    expiresAt: snapshot.expiresAt?.getTime() ?? null,
    sessionCount: null,
    updatedAt: Date.now(),
  };
}

function mapStoredSnapshot(record: {
  snapshotId: string;
  sourceSandboxId: string;
  createdAt: number;
  expiresAt: number | null;
  sessionCount?: number | null;
  updatedAt: number;
}): StoredSnapshotRecord {
  return {
    snapshotId: record.snapshotId,
    sourceSandboxId: record.sourceSandboxId,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    sessionCount: record.sessionCount ?? null,
    updatedAt: record.updatedAt,
  };
}

export async function loadStoredSnapshot(): Promise<StoredSnapshotRecord | null> {
  const snapshot = await fetchQuery(api.snapshots.get, { key: SNAPSHOT_KEY });
  return snapshot ? mapStoredSnapshot(snapshot) : null;
}

export async function saveStoredSnapshot(
  snapshot: Snapshot,
  metadata?: {
    sessionCount?: number | null;
  },
): Promise<StoredSnapshotRecord> {
  const nextSnapshot = {
    ...mapSnapshot(snapshot),
    sessionCount: metadata?.sessionCount ?? null,
  } satisfies StoredSnapshotRecord;

  await fetchMutation(api.snapshots.upsert, {
    key: SNAPSHOT_KEY,
    snapshot: nextSnapshot,
  });

  return nextSnapshot;
}

export async function clearStoredSnapshot() {
  await fetchMutation(api.snapshots.clear, {
    key: SNAPSHOT_KEY,
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
