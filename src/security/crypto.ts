/**
 * Cryptographic utilities for GLearn
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export function hash(data: string, algorithm: string = 'sha256'): string {
  return createHash(algorithm).update(data).digest('hex');
}

export function generateSalt(length: number = 16): string {
  return randomBytes(length).toString('hex');
}

/**
 * Keyed hash for verifying secrets. Uses HMAC-SHA256 with the salt as the key
 * rather than a bare `sha256(salt + data)`, which is unkeyed and trivially
 * brute-forceable offline.
 */
export function hashWithSalt(data: string, salt: string): string {
  return createHmac('sha256', salt).update(data).digest('hex');
}

export function generateToken(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

/**
 * Constant-time comparison of two strings. Hashes both inputs to fixed-length
 * digests so the comparison does not leak length and never short-circuits.
 */
export function safeEqual(a: string, b: string): boolean {
  const ah = createHmac('sha256', 'glearn-ct').update(Buffer.from(a, 'utf8')).digest();
  const bh = createHmac('sha256', 'glearn-ct').update(Buffer.from(b, 'utf8')).digest();
  return timingSafeEqual(ah, bh) && Buffer.byteLength(a) === Buffer.byteLength(b);
}

export function verifyHash(data: string, hash: string, salt: string): boolean {
  return safeEqual(hashWithSalt(data, salt), hash);
}
