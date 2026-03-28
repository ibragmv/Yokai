import 'server-only';

import { Snapshot } from '@vercel/sandbox';

import { fetchMutation, fetchQuery } from 'convex/nextjs';

import type { StoredSnapshotRecord } from '@/lib/types';
import { api } from '@convex/_generated/api';

const SNAPSHOT_KEY = 'primary';
const STATE_KEY = 'primary';

function mapSnapshot(snapshot: Snapshot): StoredSnapshotRecord {
  return {
    snapshotId: snapshot.snapshotId,
    sourceSandboxId: snapshot.sourceSandboxId,
    createdAt: snapshot.createdAt.getTime(),
    expiresAt: snapshot.expiresAt?.getTime() ?? null,
    updatedAt: Date.now(),
  };
}

function mapStoredSnapshot(record: {
  snapshotId: string;
  sourceSandboxId: string;
  createdAt: number;
  expiresAt: number | null;
  updatedAt: number;
}): StoredSnapshotRecord {
  return {
    snapshotId: record.snapshotId,
    sourceSandboxId: record.sourceSandboxId,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    updatedAt: record.updatedAt,
  };
}

async function migrateLegacyStoredSnapshot(): Promise<StoredSnapshotRecord | null> {
  const state = await fetchQuery(api.dashboard.getState, { key: STATE_KEY });
  const legacySnapshot = state?.payload.storedSnapshot ?? null;

  if (!legacySnapshot) {
    return null;
  }

  await fetchMutation(api.snapshots.upsert, {
    key: SNAPSHOT_KEY,
    snapshot: legacySnapshot,
  });
  await fetchMutation(api.dashboard.removeLegacyStoredSnapshot, {
    key: STATE_KEY,
  });

  return legacySnapshot;
}

export async function loadStoredSnapshot(): Promise<StoredSnapshotRecord | null> {
  const snapshot = await fetchQuery(api.snapshots.get, { key: SNAPSHOT_KEY });

  if (snapshot) {
    return mapStoredSnapshot(snapshot);
  }

  return await migrateLegacyStoredSnapshot();
}

export async function saveStoredSnapshot(snapshot: Snapshot): Promise<StoredSnapshotRecord> {
  const nextSnapshot = mapSnapshot(snapshot);

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
