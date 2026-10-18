import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { databaseStatus } from '../src/db.js';
import { config } from '../src/config.js';
import { createSessionStore, startSessionSweep } from '../src/middleware/session.js';
import { BCRYPT_ROUNDS, dummyPasswordHash, verifyPassword } from '../src/repositories/users.js';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

/**
 * Regression tests for the hardening pass: anonymous requests must not create
 * session rows, logout must clear the configured cookie, login must cost the
 * same for unknown users, /healthz must not run an integrity scan per request
 * and expired sessions must actually be swept.
 */

let ctx;

const sessionCount = () => ctx.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;

beforeEach(() => {
  ctx = createTestDatabase();
  buildFixture(ctx.db);
});

afterEach(() => {
  ctx.cleanup();
  vi.restoreAllMocks();
});

describe('anonymous requests do not allocate sessions', () => {
  it('serves the SPA shell without writing a session row', async () => {
    const client = createClient(ctx.db);
    const res = await request(client.app).get('/teacher/league/1').set('Accept', 'text/html');
    expect(res.status).toBe(200);
    expect(sessionCount()).toBe(0);
  });

  it('answers public metadata without writing a session row', async () => {
    const client = createClient(ctx.db);
    const res = await request(client.app).get('/api/v1/meta');
    expect(res.status).toBe(200);
    expect(sessionCount()).toBe(0);
  });

  it('still hands out a CSRF token (and one session row) to a fresh browser', async () => {
    const client = createClient(ctx.db);
    const res = await request(client.app).get('/api/v1/auth/csrf');
    expect(res.status).toBe(200);
    expect(typeof res.body.csrfToken).toBe('string');
    expect(sessionCount()).toBe(1);
  });
});

describe('login does not leak account existence', () => {
  it('runs a bcrypt comparison for an unknown username', async () => {
    const compare = vi.spyOn(bcrypt, 'compareSync');
    const client = createClient(ctx.db);
    const res = await client.login('nobody-here', 'totally-wrong');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(compare).toHaveBeenCalledTimes(1);
  });

  it('runs exactly one bcrypt comparison for a known username with a wrong password', async () => {
    const compare = vi.spyOn(bcrypt, 'compareSync');
    const client = createClient(ctx.db);
    const res = await client.login('teacher-a', 'totally-wrong');
    expect(res.status).toBe(401);
    expect(compare).toHaveBeenCalledTimes(1);
  });

  it('uses a real cost-10 placeholder hash that never verifies', () => {
    const hash = dummyPasswordHash();
    expect(hash).toMatch(/^\$2[aby]\$10\$/);
    expect(hash).toBe(dummyPasswordHash());
    expect(verifyPassword('anything', hash)).toBe(false);
    expect(BCRYPT_ROUNDS).toBe(10);
  });
});

describe('logout clears the configured cookie', () => {
  it('expires the SESSION_COOKIE_NAME cookie', async () => {
    const previous = process.env.SESSION_COOKIE_NAME;
    process.env.SESSION_COOKIE_NAME = 'league.sid';
    try {
      const client = createClient(ctx.db);
      await client.login('teacher-a', 'password-a1');
      const res = await client.logout();
      expect(res.status).toBe(200);
      const cookies = res.headers['set-cookie'].join('\n');
      expect(cookies).toContain('league.sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
      expect(sessionCount()).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.SESSION_COOKIE_NAME;
      else process.env.SESSION_COOKIE_NAME = previous;
    }
  });
});

describe('health endpoints', () => {
  it('reports the database as ok without scanning it on every request', async () => {
    const client = createClient(ctx.db);
    const res = await request(client.app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toEqual({ ok: true, integrity: 'ok' });
  });

  it('caches the integrity check instead of rerunning quick_check', () => {
    const pragma = vi.spyOn(ctx.db, 'pragma');
    const first = databaseStatus(ctx.db);
    const afterFirst = pragma.mock.calls.filter(([name]) => name === 'quick_check').length;
    const second = databaseStatus(ctx.db);
    const afterSecond = pragma.mock.calls.filter(([name]) => name === 'quick_check').length;
    expect(first.integrity).toBe('ok');
    expect(second.integrity).toBe('ok');
    // At most one scan overall, and never one per call.
    expect(afterFirst).toBeLessThanOrEqual(1);
    expect(afterSecond).toBe(afterFirst);
  });
});

describe('session store maintenance', () => {
  it('removes expired rows when the sweep runs', () => {
    const store = createSessionStore(ctx.db);
    const insert = ctx.db.prepare('INSERT INTO sessions (sid, expires, data) VALUES (?, ?, ?)');
    insert.run('expired-sid', Date.now() - 60_000, '{"cookie":{}}');
    insert.run('live-sid', Date.now() + 60_000, '{"cookie":{}}');

    const timer = startSessionSweep(store, { intervalMs: 60_000 });
    try {
      const rows = ctx.db.prepare('SELECT sid FROM sessions').all().map((row) => row.sid);
      expect(rows).toEqual(['live-sid']);
    } finally {
      clearInterval(timer);
    }
  });

  it('reports how many rows the sweep removed', () => {
    const store = createSessionStore(ctx.db);
    ctx.db.prepare('INSERT INTO sessions (sid, expires, data) VALUES (?, ?, ?)')
      .run('expired-sid', Date.now() - 60_000, '{"cookie":{}}');
    expect(store.sweep()).toBe(1);
    expect(store.sweep()).toBe(0);
  });
});

describe('proxy trust', () => {
  it('does not trust forwarded headers unless TRUST_PROXY opts in', () => {
    const previousProxy = process.env.TRUST_PROXY;
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      delete process.env.TRUST_PROXY;
      process.env.NODE_ENV = 'production';
      expect(config.trustProxy).toBe(false);
      process.env.TRUST_PROXY = 'true';
      expect(config.trustProxy).toBe(true);
    } finally {
      if (previousProxy === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = previousProxy;
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
