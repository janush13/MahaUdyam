import * as argon2 from 'argon2';

/**
 * Argon2id — preferred over bcrypt/PBKDF2 for new systems, and explicitly
 * NOT SHA-256 (a fast general-purpose hash, unsuitable for passwords).
 * Never logs, never returns the hash through any API response — callers
 * must keep `passwordHash` out of every DTO.
 */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

/** Constant-time comparison is argon2.verify's own responsibility — not
 * reimplemented here. Never throws on a malformed/foreign hash; treats
 * that as "does not match" so a corrupt stored hash can't crash a login
 * attempt. */
export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
