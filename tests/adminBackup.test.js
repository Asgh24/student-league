import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdmin } from '../src/repositories/admins.js';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

const full = 'Asgh24/league-backups';

/** Minimal in-memory GitHub Contents + Blob API for the admin backup routes. */
function fakeGithub() {
  const files = new Map();
  let counter = 0;
  const nextSha = () => (++counter).toString(16).padStart(40, 'd');
  const json = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

  async function handler(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const { pathname } = new URL(url);
    if (pathname === `/repos/${full}`) return json(200, { full_name: full, private: true });

    const blobPrefix = `/repos/${full}/git/blobs/`;
    if (pathname.startsWith(blobPrefix)) {
      const sha = decodeURIComponent(pathname.slice(blobPrefix.length));
      const entry = [...files.values()].find((file) => file.sha === sha);
      if (!entry) return json(404, { message: 'Not Found' });
      return json(200, { encoding: 'base64', content: entry.buffer.toString('base64') });
    }

    const prefix = `/repos/${full}/contents/`;
    if (!pathname.startsWith(prefix)) return json(404, { message: 'Not Found' });
    const filePath = decodeURIComponent(pathname.slice(prefix.length));

    if (method === 'GET') {
      if (files.has(filePath)) {
        const entry = files.get(filePath);
        return json(200, {
          name: filePath.split('/').pop(),
          path: filePath,
          sha: entry.sha,
          type: 'file',
          encoding: 'base64',
          size: entry.buffer.length,
          content: entry.buffer.toString('base64'),
        });
      }
      const childPrefix = `${filePath}/`;
      const children = [...files.keys()].filter((key) => key.startsWith(childPrefix));
      if (children.length > 0) {
        return json(200, children.map((key) => ({
          name: key.slice(childPrefix.length),
          path: key,
          type: 'file',
          sha: files.get(key).sha,
          size: files.get(key).buffer.length,
        })));
      }
      return json(404, { message: 'Not Found' });
    }

    if (method === 'PUT') {
      const body = JSON.parse(init.body);
      files.set(filePath, { buffer: Buffer.from(body.content, 'base64'), sha: nextSha() });
      return json(201, { content: { path: filePath }, commit: { sha: nextSha() } });
    }

    if (method === 'DELETE') {
      files.delete(filePath);
      return json(200, {});
    }

    return json(405, { message: 'Method Not Allowed' });
  }

  return { files, handler };
}

let ctx;
let adminClient;
let teacherClient;
const original = {
  repo: process.env.BACKUP_GITHUB_REPO,
  token: process.env.BACKUP_GITHUB_TOKEN,
  enabled: process.env.BACKUP_GITHUB_ENABLED,
  keep: process.env.BACKUP_GITHUB_KEEP,
  dir: process.env.BACKUP_GITHUB_DIR,
};

beforeEach(async () => {
  ctx = createTestDatabase();
  const fixture = buildFixture(ctx.db);
  createAdmin(ctx.db, { username: 'backup-admin', password: 'backup-admin-pass', displayName: 'مدیر بکاپ' });
  adminClient = createClient(ctx.db);
  teacherClient = createClient(ctx.db);
  await adminClient.login('backup-admin', 'backup-admin-pass');
  await teacherClient.login(fixture.teacherA.username, 'password-a1');

  process.env.BACKUP_GITHUB_REPO = full;
  process.env.BACKUP_GITHUB_TOKEN = 'test-token';
  process.env.BACKUP_GITHUB_ENABLED = 'true';
  process.env.BACKUP_GITHUB_KEEP = '0';
  process.env.BACKUP_GITHUB_DIR = 'db-backups';
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries({
    BACKUP_GITHUB_REPO: original.repo,
    BACKUP_GITHUB_TOKEN: original.token,
    BACKUP_GITHUB_ENABLED: original.enabled,
    BACKUP_GITHUB_KEEP: original.keep,
    BACKUP_GITHUB_DIR: original.dir,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  ctx.cleanup();
});

describe('admin backup console', () => {
  it('is admin-only and reports an unconfigured deployment without a network call', async () => {
    delete process.env.BACKUP_GITHUB_REPO;
    delete process.env.BACKUP_GITHUB_TOKEN;
    vi.stubGlobal('fetch', () => {
      throw new Error('fetch must not be called');
    });

    expect((await teacherClient.get('/api/v1/admin/backup')).status).toBe(403);
    const status = await adminClient.get('/api/v1/admin/backup');
    expect(status.status).toBe(200);
    expect(status.body.configured).toBe(false);
    expect(status.body.missing).toEqual(['BACKUP_GITHUB_REPO', 'BACKUP_GITHUB_TOKEN']);

    const run = await adminClient.post('/api/v1/admin/backup/run', {});
    expect(run.status).toBe(400);
    expect(run.body.error.code).toBe('BACKUP_NOT_CONFIGURED');
  });

  it('takes a manual GitHub backup, lists it, stages it and cancels it', async () => {
    const fake = fakeGithub();
    vi.stubGlobal('fetch', (url, init) => fake.handler(String(url), init));

    const before = await adminClient.get('/api/v1/admin/backup');
    expect(before.status).toBe(200);
    expect(before.body.configured).toBe(true);
    expect(before.body.remote.count).toBe(0);

    const run = await adminClient.post('/api/v1/admin/backup/run', {});
    expect(run.status).toBe(201);
    expect(run.body.backup.file).toMatch(/^league-\d{8}T\d{6}Z\.db$/);
    expect(fake.files.size).toBe(2);

    const after = await adminClient.get('/api/v1/admin/backup');
    expect(after.body.remote.count).toBe(1);
    expect(after.body.remote.newest.name).toBe(run.body.backup.file);

    const staged = await adminClient.post('/api/v1/admin/backup/restore', { file: run.body.backup.file });
    expect(staged.status).toBe(202);
    expect(staged.body.staged).toBe(true);
    expect(staged.body.restartRequired).toBe(true);

    const pending = await adminClient.get('/api/v1/admin/backup');
    expect(pending.body.pendingRestore.sourceFile).toBe(run.body.backup.file);

    const canceled = await adminClient.del('/api/v1/admin/backup/restore');
    expect(canceled.status).toBe(200);
    expect(canceled.body.canceled).toBe(true);
    expect((await adminClient.get('/api/v1/admin/backup')).body.pendingRestore).toBeNull();
  });

  it('downloads a consistent local SQLite snapshot', async () => {
    const response = await adminClient.get('/api/v1/admin/backup/download');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['content-disposition']).toContain('attachment');
    const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.text ?? '', 'binary');
    expect(body.subarray(0, 16).toString('utf8')).toBe('SQLite format 3\u0000');
  });
});
