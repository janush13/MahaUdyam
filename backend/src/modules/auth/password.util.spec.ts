import { hashPassword, verifyPassword } from './password.util';

describe('password.util', () => {
  it('hashes a password to something that is not the plaintext', async () => {
    const hash = await hashPassword('Str0ngPassword');
    expect(hash).not.toBe('Str0ngPassword');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('Str0ngPassword');
    await expect(verifyPassword(hash, 'Str0ngPassword')).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('Str0ngPassword');
    await expect(verifyPassword(hash, 'WrongPassword')).resolves.toBe(false);
  });

  it('never throws on a malformed/foreign hash — treats it as no-match', async () => {
    await expect(verifyPassword('not-a-real-hash', 'anything')).resolves.toBe(
      false,
    );
  });
});
