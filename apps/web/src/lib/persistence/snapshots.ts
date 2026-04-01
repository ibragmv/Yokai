import 'server-only';

import { Snapshot } from '@vercel/sandbox';

import { fetchMutation, fetchQuery } from 'convex/nextjs';

import type { StorageAssetId, StoredSnapshotRecord } from '@/lib/types';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';

const SNAPSHOT_KEY = 'primary';

function mapSnapshot(snapshot: Snapshot): StoredSnapshotRecord {
  return {
    snapshotId: snapshot.snapshotId,
    sourceSandboxId: snapshot.sourceSandboxId,
    createdAt: snapshot.createdAt.getTime(),
    expiresAt: snapshot.expiresAt?.getTime() ?? null,
    sessionCount: null,
    backupBundleStorageId: null,
    backupBundleSize: null,
    backupSessionsStorageId: null,
    backupSessionsSize: null,
    updatedAt: Date.now(),
  };
}

function toStorageAssetId(value: unknown): StorageAssetId {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Convex backup upload did not return a valid storageId.');
  }

  return value as Id<'_storage'>;
}

function mapStoredSnapshot(record: {
  snapshotId: string;
  sourceSandboxId: string;
  createdAt: number;
  expiresAt: number | null;
  sessionCount?: number | null;
  backupBundleStorageId?: StorageAssetId | null;
  backupBundleSize?: number | null;
  backupSessionsStorageId?: StorageAssetId | null;
  backupSessionsSize?: number | null;
  updatedAt: number;
}): StoredSnapshotRecord {
  return {
    snapshotId: record.snapshotId,
    sourceSandboxId: record.sourceSandboxId,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    sessionCount: record.sessionCount ?? null,
    backupBundleStorageId: record.backupBundleStorageId ?? null,
    backupBundleSize: record.backupBundleSize ?? null,
    backupSessionsStorageId: record.backupSessionsStorageId ?? null,
    backupSessionsSize: record.backupSessionsSize ?? null,
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
    backupBundleStorageId?: StorageAssetId | null;
    backupBundleSize?: number | null;
    backupSessionsStorageId?: StorageAssetId | null;
    backupSessionsSize?: number | null;
  },
): Promise<StoredSnapshotRecord> {
  const nextSnapshot = {
    ...mapSnapshot(snapshot),
    sessionCount: metadata?.sessionCount ?? null,
    backupBundleStorageId: metadata?.backupBundleStorageId ?? null,
    backupBundleSize: metadata?.backupBundleSize ?? null,
    backupSessionsStorageId: metadata?.backupSessionsStorageId ?? null,
    backupSessionsSize: metadata?.backupSessionsSize ?? null,
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

async function uploadBackupAsset(buffer: Buffer, contentType: string): Promise<StorageAssetId> {
  const uploadUrl = await fetchMutation(api.snapshots.generateBackupUploadUrl, {});
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
    },
    body: bytes.buffer,
  });

  if (!response.ok) {
    throw new Error(`Convex backup upload failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { storageId?: string };
  return toStorageAssetId(payload.storageId);
}

export async function uploadStoredBackupBundle(buffer: Buffer) {
  return await uploadBackupAsset(buffer, 'application/gzip');
}

export async function uploadStoredBackupSessions(buffer: Buffer) {
  return await uploadBackupAsset(buffer, 'application/json');
}

export async function downloadStoredBackupAsset(storageId: StorageAssetId | null | undefined) {
  if (!storageId) {
    return null;
  }

  const assetUrl = await fetchQuery(api.snapshots.getBackupAssetUrl, { storageId });
  if (!assetUrl) {
    return null;
  }

  const response = await fetch(assetUrl, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Convex backup download failed with status ${response.status}.`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function deleteStoredBackupAsset(storageId: StorageAssetId | null | undefined) {
  if (!storageId) {
    return;
  }

  await fetchMutation(api.snapshots.deleteBackupAsset, { storageId });
}
