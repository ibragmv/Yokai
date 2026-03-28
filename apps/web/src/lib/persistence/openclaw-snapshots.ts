import 'server-only';

import { Snapshot } from '@vercel/sandbox';

import { readDashboardState, updateDashboardState } from '@/lib/store';
import type { StoredSnapshotRecord } from '@/lib/types';

function mapSnapshot(snapshot: Snapshot): StoredSnapshotRecord {
  return {
    snapshotId: snapshot.snapshotId,
    sourceSandboxId: snapshot.sourceSandboxId,
    createdAt: snapshot.createdAt.getTime(),
    expiresAt: snapshot.expiresAt?.getTime() ?? null,
    updatedAt: Date.now(),
  };
}

export async function loadStoredSnapshot(): Promise<StoredSnapshotRecord | null> {
  const state = await readDashboardState();
  return state.storedSnapshot;
}

export async function saveStoredSnapshot(snapshot: Snapshot): Promise<StoredSnapshotRecord> {
  const nextSnapshot = mapSnapshot(snapshot);

  await updateDashboardState((current) => ({
    ...current,
    storedSnapshot: nextSnapshot,
  }));

  return nextSnapshot;
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
