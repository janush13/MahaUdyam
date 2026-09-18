import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;

export class InvalidMfaEncryptionKeyError extends Error {
  constructor() {
    super('MFA_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes.');
    this.name = 'InvalidMfaEncryptionKeyError';
  }
}

export function deriveKeyFromConfig(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new InvalidMfaEncryptionKeyError();
  }
  return key;
}

/** Encrypts a TOTP secret for storage in mfa_credentials.totp_secret.
 * Output format: `<iv>:<authTag>:<ciphertext>`, each base64. */
export function encryptSecret(plainText: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function decryptSecret(cipherText: string, key: Buffer): string {
  const parts = cipherText.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted MFA secret.');
  }
  const [ivB64, tagB64, dataB64] = parts;

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
