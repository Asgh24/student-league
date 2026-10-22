import { afterEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/lib/secrets.js';

const originalSession = process.env.SESSION_SECRET;
const originalSecrets = process.env.SECRETS_KEY;

afterEach(() => {
  if (originalSession === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSession;
  if (originalSecrets === undefined) delete process.env.SECRETS_KEY;
  else process.env.SECRETS_KEY = originalSecrets;
});

describe('provider secret encryption key', () => {
  it('keeps values readable when the session secret rotates', () => {
    process.env.SECRETS_KEY = 'stable-secrets-key-that-never-rotates';
    process.env.SESSION_SECRET = 'first-session-secret-long-enough';
    const encrypted = encryptSecret('sms-ir-api-key');

    process.env.SESSION_SECRET = 'second-session-secret-long-enough';

    expect(encrypted).not.toContain('sms-ir-api-key');
    expect(decryptSecret(encrypted)).toBe('sms-ir-api-key');
  });

  it('decrypts legacy rows when SECRETS_KEY is set to the old session secret', () => {
    delete process.env.SECRETS_KEY;
    process.env.SESSION_SECRET = 'legacy-session-secret-long-enough';
    const legacy = encryptSecret('legacy-groq-key');

    // This is how an existing deployment migrates: SECRETS_KEY keeps the old
    // value, while SESSION_SECRET can now rotate independently.
    process.env.SECRETS_KEY = 'legacy-session-secret-long-enough';
    process.env.SESSION_SECRET = 'rotated-session-secret-long-enough';

    expect(decryptSecret(legacy)).toBe('legacy-groq-key');
  });

  it('rejects tampered ciphertext instead of returning garbage', () => {
    process.env.SECRETS_KEY = 'stable-secrets-key-that-never-rotates';
    process.env.SESSION_SECRET = 'session-secret-long-enough';
    const encrypted = encryptSecret('secret-value');
    const parts = encrypted.split('.');
    parts[3] = `${parts[3].slice(0, -2)}xx`;

    expect(decryptSecret(parts.join('.'))).toBe('');
    expect(decryptSecret('not-a-ciphertext')).toBe('');
    expect(encryptSecret('')).toBe('');
  });
});
