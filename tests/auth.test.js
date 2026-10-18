import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let client;

beforeEach(() => {
  ctx = createTestDatabase();
  buildFixture(ctx.db);
  client = createClient(ctx.db);
});

afterEach(() => {
  ctx.cleanup();
});

describe('authentication', () => {
  it('rejects a state changing request without a CSRF token', async () => {
    const res = await client.postRaw('/api/v1/auth/login', { username: 'teacher-a', password: 'password-a1' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INVALID_CSRF');
  });

  it('rejects a stale CSRF token that belongs to another session', async () => {
    await client.csrf();
    const stale = client.token;
    await client.logout();
    const res = await client.postRaw('/api/v1/auth/login', { username: 'teacher-a', password: 'password-a1' }, { 'x-csrf-token': stale });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INVALID_CSRF');
  });

  it('logs in with valid credentials and exposes the session user', async () => {
    const res = await client.login('teacher-a', 'password-a1');
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('teacher');
    expect(res.body.user.displayName).toBe('خانم الف');
    expect(typeof res.body.csrfToken).toBe('string');

    const me = await client.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('teacher-a');
  });

  it('rejects a wrong password with 401', async () => {
    const res = await client.login('teacher-a', 'totally-wrong');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an unknown username with 401', async () => {
    const res = await client.login('nobody-here', 'password-a1');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns validation details for a short username', async () => {
    const res = await client.login('ab', 'password-a1');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('requires authentication for protected endpoints', async () => {
    const res = await client.get('/api/v1/leagues');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('separates roles: a student cannot call teacher endpoints', async () => {
    await client.login('student-a', 'student-a1');
    const res = await client.get('/api/v1/leagues');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('separates roles: a teacher cannot call student endpoints', async () => {
    await client.login('teacher-a', 'password-a1');
    const res = await client.get('/api/v1/student/dashboard');
    expect(res.status).toBe(403);
  });

  it('destroys the session on logout', async () => {
    await client.login('teacher-a', 'password-a1');
    const out = await client.logout();
    expect(out.status).toBe(200);
    const me = await client.get('/api/v1/auth/me');
    expect(me.body.user).toBeNull();
  });

  it('rate limits repeated failed logins', async () => {
    process.env.LOGIN_RATE_LIMIT = '3';
    try {
      const limited = createClient(ctx.db);
      const statuses = [];
      for (let i = 0; i < 5; i += 1) {
        const res = await limited.login('teacher-a', 'wrong-password');
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 3).every((s) => s === 401)).toBe(true);
      expect(statuses[statuses.length - 1]).toBe(429);
    } finally {
      process.env.LOGIN_RATE_LIMIT = '500';
    }
  });

  it('changes the password and rejects the old one afterwards', async () => {
    await client.login('teacher-a', 'password-a1');
    const res = await client.post('/api/v1/auth/password', { currentPassword: 'password-a1', newPassword: 'brand-new-pass' });
    expect(res.status).toBe(200);

    const fresh = createClient(ctx.db);
    const old = await fresh.login('teacher-a', 'password-a1');
    expect(old.status).toBe(401);
    const updated = await fresh.login('teacher-a', 'brand-new-pass');
    expect(updated.status).toBe(200);
  });
});
