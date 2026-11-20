import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { frontendReleaseId } from '../src/version.js';
import { createTestDatabase } from './helpers.js';

const cleanups = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()();
});

describe('application release identity', () => {
  it('changes its fingerprint when a frontend file changes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-release-'));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'main.js'), 'const version = 1;');
    const first = frontendReleaseId(dir);

    fs.writeFileSync(path.join(dir, 'main.js'), 'const version = 2;');
    const second = frontendReleaseId(dir);

    expect(first).toMatch(/^[a-f0-9]{16}$/);
    expect(second).not.toBe(first);
  });

  it('serves a lightweight uncached version endpoint and metadata release', async () => {
    const ctx = createTestDatabase();
    cleanups.push(ctx.cleanup);
    const app = createApp({ db: ctx.db, version: '2.4.0', release: 'release-test' });

    const version = await request(app).get('/healthz/version');
    expect(version.status).toBe(200);
    expect(version.headers['cache-control']).toBe('no-store');
    expect(version.body).toEqual({ version: '2.4.0', release: 'release-test' });

    const meta = await request(app).get('/api/v1/meta');
    expect(meta.status).toBe(200);
    expect(meta.headers['cache-control']).toBe('no-store');
    expect(meta.body.release).toBe('release-test');
    expect(meta.body.version).toBe('2.4.0');
  });
});
