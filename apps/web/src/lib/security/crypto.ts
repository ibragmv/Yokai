import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIRECTORY = path.join(process.cwd(), '.data');
const KEY_FILE = path.join(DATA_DIRECTORY, 'yokai-master-key');
const CIPHER = 'aes-256-gcm';

type EncryptedPayload = {
  iv: string;
  tag: string;
  value: string;
};

async function getOrCreateLocalKey(): Promise<string> {
  try {
    return (await readFile(KEY_FILE, 'utf8')).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    await mkdir(DATA_DIRECTORY, { recursive: true });
    const nextKey = randomBytes(32).toString('base64url');
    await writeFile(KEY_FILE, nextKey, { encoding: 'utf8', mode: 0o600 });
    return nextKey;
  }
}

async function loadEncryptionKey(): Promise<Buffer> {
  const sourceKey = process.env.YOKAI_ENCRYPTION_KEY || (await getOrCreateLocalKey());
  return createHash('sha256').update(sourceKey).digest();
}

export async function encryptValue(value: string): Promise<EncryptedPayload> {
  const key = await loadEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

  return {
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    value: encrypted.toString('base64url'),
  };
}

export async function decryptValue(payload: EncryptedPayload): Promise<string> {
  const key = await loadEncryptionKey();
  const decipher = createDecipheriv(CIPHER, key, Buffer.from(payload.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.value, 'base64url')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
