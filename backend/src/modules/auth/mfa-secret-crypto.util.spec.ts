import { randomBytes } from 'node:crypto';
import {
  decryptSecret,
  deriveKeyFromConfig,
  encryptSecret,
  InvalidMfaEncryptionKeyError,
} from './mfa-secret-crypto.util';

describe('mfa-secret-crypto.util', () => {
  const key = randomBytes(32);

  it('round-trips a secret through encrypt/decrypt', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptSecret(secret, key);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted, key)).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    expect(encryptSecret(secret, key)).not.toBe(encryptSecret(secret, key));
  });

  it('fails to decrypt with the wrong key', () => {
    const encrypted = encryptSecret('JBSWY3DPEHPK3PXP', key);
    const wrongKey = randomBytes(32);
    expect(() => decryptSecret(encrypted, wrongKey)).toThrow();
  });

  it('rejects malformed ciphertext', () => {
    expect(() => decryptSecret('not:enough', key)).toThrow(
      'Malformed encrypted MFA secret.',
    );
  });

  describe('deriveKeyFromConfig', () => {
    it('accepts a valid 32-byte base64 key', () => {
      const validKey = randomBytes(32).toString('base64');
      expect(deriveKeyFromConfig(validKey).length).toBe(32);
    });

    it('rejects a key of the wrong length', () => {
      const shortKey = randomBytes(16).toString('base64');
      expect(() => deriveKeyFromConfig(shortKey)).toThrow(
        InvalidMfaEncryptionKeyError,
      );
    });
  });
});
