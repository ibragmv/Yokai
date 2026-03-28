import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const CIPHER = 'aes-256-gcm';
const ENCRYPTION_KEY_ENV = 'YOKAI_ENCRYPTION_KEY';

type EncryptedPayload = {
  iv: string;
  tag: string;
  value: string;
};

function getEncryptionSecret(): string {
  const encryptionKey = process.env[ENCRYPTION_KEY_ENV]?.trim();

  if (!encryptionKey) {
    throw new Error(
      `${ENCRYPTION_KEY_ENV} is required. Configure a stable shared secret for all environments.`,
    );
  }

  return encryptionKey;
}

async function loadEncryptionKey(): Promise<Buffer> {
  const sourceKey = getEncryptionSecret();
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
