/**
 * Small symmetric helper for provider credentials stored in SQLite.
 *
 * sms.ir and Groq API keys are secrets: they are never returned by an API and
 * they are encrypted with a stable deployment key before they touch the
 * database. `SECRETS_KEY` is deliberately separate from `SESSION_SECRET`, so
 * rotating the session secret does not make a restored backup undecryptable.
 * Deployments that predate `SECRETS_KEY` keep using their session secret; reads
 * also try the session secret so old rows can be decrypted and re-saved.
 */

import crypto from 'node:crypto';
import { config } from '../config.js';

const VERSION = 'v1';

function derive(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest();
}

/** Current key first, then the legacy session-secret key. */
function encryptionKeys() {
  const secrets = [config.secretsKey, config.sessionSecret].filter(Boolean);
  return [...new Set(secrets)].map(derive);
}

function encryptionKey() {
  return derive(config.secretsKey);
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
  for (const key of encryptionKeys()) {
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(parts[1], 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(parts[3], 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      /* try the legacy key before giving up */
    }
  }
  return '';
}
