/**
 * Small symmetric helper for provider credentials stored in SQLite.
 *
 * sms.ir API keys are secrets: they are never returned by an API and they are
 * encrypted with a key derived from the deployment's `SESSION_SECRET` before
 * they touch the database. Rotating the session secret therefore also requires
 * re-entering the sms.ir key, which is the safe failure mode for this app.
 */

import crypto from 'node:crypto';
import { config } from '../config.js';

const VERSION = 'v1';

function encryptionKey() {
  return crypto.createHash('sha256').update(config.sessionSecret).digest();
}

export function encryptSecret(value) {
  const plain = String(value ?? '');
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptSecret(value) {
  const stored = String(value ?? '');
  if (!stored) return '';
  // The version prefix makes future format migrations possible. A value without
  // it can only come from a manually edited database; do not silently use it.
  if (!stored.startsWith(`${VERSION}.`)) return '';
  const parts = stored.split('.');
  if (parts.length !== 4) return '';
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(parts[1], 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}
