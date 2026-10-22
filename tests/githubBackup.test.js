import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/db.js';
import { config } from '../src/config.js';
import { runMigrations } from '../src/migrate.js';
import { migrations } from '../src/migrations/index.js';
import { createLeague } from '../src/repositories/leagues.js';
import { createUser } from '../src/repositories/users.js';
import {
  applyStagedRestore,
  backupStamp,
  backupStatus,
  cancelStagedRestore,
  createClientFor,
  databaseIsEmpty,
  isConfigured,
  listSnapshots,
  MANIFEST_NAME,
  missingSettings,
  pushBackup,
  readManifest,
  readRemoteFile,
  restoreFromGithub,
  restoreOnBoot,
  stageRestore,
} from '../src/services/githubBackup.js';
import { createBackupScheduler, msUntilDue, readState, writeState } from '../src/services/backupScheduler.js';

/**
 * In-memory stand-in for the two GitHub REST endpoints the backup feature uses
 * (repository lookup + the Contents API). It stores real base64 blobs, so a
 * push and a restore round trip are exercised end to end with no network.
 */
function createFakeGithub({ owner = 'Asgh24', name = 'league-backups', privateRepo = true, largeFileThreshold = 1024 * 1024 } = {}) {
  const full = `${owner}/${name}`;
  const files = new Map();
  const commits = [];
  const calls = [];
  let counter = 0;
  const nextSha = () => (++counter).toString(16).padStart(40, 'c');
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  async function handler(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const { pathname } = new URL(url);
    calls.push({ method, pathname, headers: init.headers ?? {} });

    if (pathname === `/repos/${full}`) return json(200, { full_name: full, private: privateRepo, default_branch: 'main' });

    // The Blob API is how snapshots above the Contents API's 1 MB inline limit
    // are fetched. It takes the blob SHA, not a path.
    const blobPrefix = `/repos/${full}/git/blobs/`;
    if (pathname.startsWith(blobPrefix)) {
      const sha = decodeURIComponent(pathname.slice(blobPrefix.length));
      const entry = [...files.values()].find((file) => file.sha === sha);
      if (!entry) return json(404, { message: 'Not Found' });
      return json(200, { sha, encoding: 'base64', size: entry.buffer.length, content: entry.buffer.toString('base64') });
    }

    const prefix = `/repos/${full}/contents/`;
    if (!pathname.startsWith(prefix)) return json(404, { message: 'Not Found' });
    const filePath = decodeURIComponent(pathname.slice(prefix.length));

    if (method === 'GET') {
      if (files.has(filePath)) {
        const entry = files.get(filePath);
        const inline = entry.buffer.length <= largeFileThreshold || !filePath.endsWith('.db');
        return json(200, {
          name: filePath.split('/').pop(),
          path: filePath,
          sha: entry.sha,
          type: 'file',
          encoding: inline ? 'base64' : 'none',
          size: entry.buffer.length,
          ...(inline ? { content: entry.buffer.toString('base64') } : {}),
        });
      }
      const childPrefix = `${filePath}/`;
      const children = [...files.keys()].filter((key) => key.startsWith(childPrefix));
      if (children.length > 0) {
        return json(200, children.map((key) => ({ name: key.slice(childPrefix.length), path: key, type: 'file', sha: files.get(key).sha, size: files.get(key).buffer.length })));
      }
      return json(404, { message: 'Not Found' });
    }

    if (method === 'PUT') {
      const body = JSON.parse(init.body);
      const current = files.get(filePath);
      if (body.sha && current && body.sha !== current.sha) return json(409, { message: 'sha does not match' });
      const buffer = Buffer.from(body.content, 'base64');
      files.set(filePath, { buffer, sha: nextSha() });
      commits.push({ path: filePath, message: body.message });
      return json(201, { content: { path: filePath, sha: files.get(filePath).sha }, commit: { sha: nextSha() } });
    }

    if (method === 'DELETE') {
      if (!files.has(filePath)) return json(404, { message: 'Not Found' });
      files.delete(filePath);
      commits.push({ path: filePath, message: JSON.parse(init.body).message });
      return json(200, {});
    }

    return json(405, { message: 'Method Not Allowed' });
  }

  return { full, files, commits, calls, handler };
}

/** Routes the real client through the fake by replacing the global fetch. */
function useFake(fake) {
  vi.stubGlobal('fetch', (url, init) => fake.handler(String(url), init));
}

function testCfg(overrides = {}) {
  return {
    ...config.githubBackup,
    enabled: true,
    token: 'test-token',
    repo: 'Asgh24/league-backups',
    branch: 'main',
    dir: 'db-backups',
    filePrefix: 'league',
    intervalMinutes: 60,
    keep: 7,
    startDelayMs: 0,
    maxBytes: 50 * 1024 * 1024,
    restoreOnEmpty: true,
    allowPublicRepo: false,
    apiBaseUrl: 'https://api.github.com',
    ...overrides,
  };
}

const cleanups = [];
afterEach(() => {
  vi.unstubAllGlobals();
  while (cleanups.length > 0) cleanups.pop()();
  // The push path writes a temporary snapshot next to the live database; it must
  // always be removed, even when an upload fails.
  for (const entry of fs.readdirSync(config.dataDir)) {
    if (/^\.league-.*\.tmp$/.test(entry)) throw new Error(`temporary snapshot file left behind: ${entry}`);
  }
});

/** Temp database with the full schema applied. */
function openTestDb(label = 'source') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `scl-gh-${label}-`));
  const file = path.join(dir, 'league.db');
  const db = openDatabase(file);
  runMigrations(db, migrations);
  cleanups.push(() => {
    closeQuietly(db);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { db, file, dir };
}

/** Temp database with no schema at all, the "container was recreated" case. */
function openEmptyDb(label = 'target') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `scl-gh-${label}-`));
  const file = path.join(dir, 'league.db');
  const db = openDatabase(file);
  cleanups.push(() => {
    closeQuietly(db);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { db, file, dir };
}

function closeQuietly(db) {
  try {
    if (db?.open) db.close();
  } catch {
    /* already closed by the code under test */
  }
}

function tempStateFile() {
  const file = path.join(os.tmpdir(), `scl-gh-state-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  cleanups.push(() => fs.rmSync(file, { force: true }));
  return file;
}

describe('github backup configuration', () => {
  it('reports which settings are missing', () => {
    expect(isConfigured(testCfg())).toBe(true);
    expect(isConfigured(testCfg({ repo: '' }))).toBe(false);
    expect(missingSettings(testCfg({ repo: '', token: '' }))).toEqual(['BACKUP_GITHUB_REPO', 'BACKUP_GITHUB_TOKEN']);
    expect(missingSettings(testCfg({ repo: '' }))).toEqual(['BACKUP_GITHUB_REPO']);
  });

  it('builds sortable stamps', () => {
    expect(backupStamp(new Date('2026-10-18T21:15:00Z'))).toBe('20261018T211500Z');
  });

  it('refuses to upload when it is not configured, without any network call', async () => {
    const { db } = openTestDb();
    vi.stubGlobal('fetch', () => {
      throw new Error('fetch must not be called');
    });
    await expect(pushBackup({ db, cfg: testCfg({ repo: '', token: '' }) })).rejects.toThrow(/not configured/i);
  });
});

describe('github backup push', () => {
  it('uploads the snapshot plus a manifest whose checksum matches the stored bytes', async () => {
    const fake = createFakeGithub();
    useFake(fake);
    const cfg = testCfg({ repo: fake.full });
    const { db } = openTestDb();
    createUser(db, { username: 'teacher', password: 'long-password', role: 'teacher', displayName: 'معلم' });

    const result = await pushBackup({ db, cfg, log: () => {}, now: new Date('2026-10-18T20:00:00Z'), appVersion: '1.0.0' });

    expect(result.file).toBe('league-20261018T200000Z.db');
    expect(result.path).toBe(`db-backups/${result.file}`);
    expect(result.pruned).toEqual([]);
    expect(result.commit).toBeTruthy();

    const uploaded = fake.files.get(`db-backups/${result.file}`);
    expect(uploaded).toBeTruthy();
    expect(crypto.createHash('sha256').update(uploaded.buffer).digest('hex')).toBe(result.sha256);
    expect(uploaded.buffer.subarray(0, 16).toString('utf8')).toBe('SQLite format 3\u0000');

    const manifest = JSON.parse(fake.files.get(`db-backups/${MANIFEST_NAME}`).buffer.toString('utf8'));
    expect(manifest).toMatchObject({ file: result.file, sha256: result.sha256, bytes: result.bytes, appVersion: '1.0.0' });
    expect(Number.isInteger(manifest.schemaMigrations)).toBe(true);
    expect(manifest.schemaMigrations).toBeGreaterThan(0);

    expect(fake.commits.map((commit) => commit.message)).toEqual([
      `chore(backup): ${result.file}`,
      `chore(backup): manifest for ${result.file}`,
    ]);
    expect(fake.calls.every((call) => call.headers.authorization === 'Bearer test-token')).toBe(true);
  });

  it('restores exactly what it uploaded', async () => {
    const fake = createFakeGithub();
    useFake(fake);
    const cfg = testCfg({ repo: fake.full });
    const source = openTestDb();
    const teacher = createUser(source.db, { username: 'teacher', password: 'long-password', role: 'teacher', displayName: 'معلم' });
    createLeague(source.db, teacher.id, 'لیگ نمونه');
    await pushBackup({ db: source.db, cfg, log: () => {} });
    closeQuietly(source.db);

    const target = openEmptyDb();
    const result = await restoreOnBoot({ db: target.db, cfg, databaseFile: target.file, log: () => {}, open: openDatabase });
    expect(result.restored).toBe(true);
    cleanups.push(() => closeQuietly(result.db));

    expect(result.db.prepare('SELECT name FROM leagues').all().map((row) => row.name)).toEqual(['لیگ نمونه']);
    expect(result.db.prepare('SELECT username FROM users').all().map((row) => row.username)).toEqual(['teacher']);

    const status = await backupStatus({ cfg });
    expect(status.repo).toBe(fake.full);
    expect(status.snapshots).toBe(1);
    expect(status.manifest.file).toBe(result.manifest.file);
  });

  it('keeps only the newest snapshots and never deletes the manifest', async () => {
    const fake = createFakeGithub();
    useFake(fake);
    const cfg = testCfg({ repo: fake.full, keep: 2 });
    const { db } = openTestDb();

    for (const hour of [10, 11, 12, 13]) {
      await pushBackup({ db, cfg, log: () => {}, now: new Date(`2026-10-18T${hour}:00:00Z`) });
    }

    expect([...fake.files.keys()].filter((key) => key.endsWith('.db')).sort()).toEqual([
      'db-backups/league-20261018T120000Z.db',
      'db-backups/league-20261018T130000Z.db',
    ]);
    expect(fake.files.has(`db-backups/${MANIFEST_NAME}`)).toBe(true);

    const status = await backupStatus({ cfg });
    expect(status.snapshots).toBe(2);
    expect(status.newest).toBe('league-20261018T130000Z.db');
  });

  it('keeps every snapshot when BACKUP_GITHUB_KEEP is 0', async () => {
    const fake = createFakeGithub();
    useFake(fake);
    const cfg = testCfg({ repo: fake.full, keep: 0 });
    const { db } = openTestDb();
    for (const hour of [10, 11, 12]) {
      await pushBackup({ db, cfg, log: () => {}, now: new Date(`2026-10-18T${hour}:00:00Z`) });
    }
    expect([...fake.files.keys()].filter((key) => key.endsWith('.db'))).toHaveLength(3);
  });

  it('never overwrites a local database that already has data', async () => {
    const fake = createFakeGithub();
    useFake(fake);
    const cfg = testCfg({ repo: fake.full });
    const { db } = openTestDb();
    const teacher = createUser(db, { username: 'local-teacher', password: 'long-password', role: 'teacher', displayName: 'معلم محلی' });
    createLeague(db, teacher.id, 'لیگ محلی');
    const callsBefore = fake.calls.length;

    const result = await restoreOnBoot({ db, cfg, log: () => {} });

    expect(result).toMatchObject({ restored: false, reason: 'local-database-has-data' });
    expect(result.db).toBe(db);
    expect(fake.calls.length).toBe(callsBefore);
  });

  it('treats a schema-only database as empty and restores it', async () => {
    const fake = createFakeGithub();
    useFake(fake);
    const cfg = testCfg({ repo: fake.full });
    const source = openTestDb();
    const teacher = createUser(source.db, { username: 'teacher', password: 'long-password', role: 'teacher', displayName: 'معلم' });
    createLeague(source.db, teacher.id, 'لیگ بازیابی‌شده');
    await pushBackup({ db: source.db, cfg, log: () => {} });
    closeQuietly(source.db);

    const target = openTestDb('schema-only');
    expect(databaseIsEmpty(target.db)).toBe(true);
    const result = await restoreOnBoot({ db: target.db, cfg, databaseFile: target.file, log: () => {}, open: openDatabase });
    expect(result.restored).toBe(true);
    cleanups.push(() => closeQuietly(result.db));
    expect(result.db.prepare('SELECT name FROM leagues').all().map((row) => row.name)).toEqual(['لیگ بازیابی‌شده']);
  });

  it('stages a snapshot for the next boot instead of swapping a live connection', async () => {
    const fake = createFakeGithub();
    useFake(fake);
    const cfg = testCfg({ repo: fake.full });
    const source = openTestDb();
    const teacher = createUser(source.db, { username: 'teacher', password: 'long-password', role: 'teacher', displayName: 'معلم' });
    createLeague(source.db, teacher.id, 'لیگ مرحله‌ای');
    await pushBackup({ db: source.db, cfg, log: () => {} });
    closeQuietly(source.db);

    const target = openEmptyDb();
    const staged = await stageRestore({ cfg, databaseFile: target.file, log: () => {} });
    expect(staged.staged).toBe(true);
    expect(staged.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.existsSync(staged.stagedFile)).toBe(true);
    // The live database is still the empty one.
    expect(target.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([]);

    closeQuietly(target.db);
    const applied = await applyStagedRestore({ databaseFile: target.file, log: () => {} });
    expect(applied.applied).toBe(true);
    expect(fs.existsSync(staged.stagedFile)).toBe(false);

    const restored = openDatabase(target.file);
    cleanups.push(() => closeQuietly(restored));
    expect(restored.prepare('SELECT name FROM leagues').all().map((row) => row.name)).toEqual(['لیگ مرحله‌ای']);
  });

  it('cancels a staged restore and leaves the local database untouched', async () => {
    const fake = createFakeGithub();
    useFake(fake);
    const cfg = testCfg({ repo: fake.full });
    const source = openTestDb();
    await pushBackup({ db: source.db, cfg, log: () => {} });
    closeQuietly(source.db);

    const target = openEmptyDb();
    const staged = await stageRestore({ cfg, databaseFile: target.file, log: () => {} });
    expect(staged.staged).toBe(true);
    const canceled = await cancelStagedRestore({ databaseFile: target.file });
    expect(canceled.canceled).toBe(true);
    expect(fs.existsSync(staged.stagedFile)).toBe(false);

    const applied = await applyStagedRestore({ databaseFile: target.file, log: () => {} });
    expect(applied).toMatchObject({ applied: false, reason: 'no-marker' });
    expect(target.db.prepare('SELECT 1 AS ok').get().ok).toBe(1);
  });

  it('downloads snapshots over the Contents API inline limit through the Blob API', async () => {
    const fake = createFakeGithub({ largeFileThreshold: 10 });
    useFake(fake);
    const cfg = testCfg({ repo: fake.full });
    const { db } = openTestDb();
    await pushBackup({ db, cfg, log: () => {}, now: new Date('2026-10-18T08:00:00Z') });

    const file = await readRemoteFile(createClientFor(cfg), cfg, 'league-20261018T080000Z.db');
    expect(file.buffer.subarray(0, 16).toString('utf8')).toBe('SQLite format 3\u0000');
    expect(fake.calls.some((call) => call.pathname.includes('/git/blobs/'))).toBe(true);
  });

  it('leaves the local file alone when the remote checksum does not match', async () => {
    const fake = createFakeGithub();
    useFake(fake);
    const cfg = testCfg({ repo: fake.full });
    const source = openTestDb();
    await pushBackup({ db: source.db, cfg, log: () => {}, now: new Date('2026-10-18T09:00:00Z') });
    closeQuietly(source.db);

    fake.files.get('db-backups/league-20261018T090000Z.db').buffer = Buffer.from('truncated upload');

    const target = openEmptyDb();
    await expect(restoreFromGithub({ cfg, databaseFile: target.file, log: () => {}, open: openDatabase })).rejects.toThrow(/checksum mismatch/i);

    const result = await restoreOnBoot({ db: target.db, cfg, databaseFile: target.file, log: () => {}, open: openDatabase });
    expect(result).toMatchObject({ restored: false, reason: 'failed' });
    cleanups.push(() => closeQuietly(result.db));
    expect(result.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([]);
  });

  it('does not touch the local file when the remote snapshot is missing', async () => {
    const fake = createFakeGithub();
    useFake(fake);
    const cfg = testCfg({ repo: fake.full });
    const target = openEmptyDb();
    const result = await restoreOnBoot({ db: target.db, cfg, databaseFile: target.file, log: () => {}, open: openDatabase });
    expect(result).toMatchObject({ restored: false, reason: 'no-manifest' });
    expect(result.db.open).toBe(true);
    cleanups.push(() => closeQuietly(result.db));
  });

  it('refuses a public repository unless it is explicitly allowed', async () => {
    const fake = createFakeGithub({ privateRepo: false });
    useFake(fake);
    const { db } = openTestDb();

    await expect(pushBackup({ db, cfg: testCfg({ repo: fake.full }), log: () => {} })).rejects.toThrow(/public repository/i);
    expect(fake.files.size).toBe(0);

    const allowed = await pushBackup({ db, cfg: testCfg({ repo: fake.full, allowPublicRepo: true }), log: () => {} });
    expect(allowed.file).toMatch(/^league-\d{8}T\d{6}Z\.db$/);
    expect(fake.files.size).toBe(2);
  });

  it('explains a repository the token cannot see', async () => {
    const fake = createFakeGithub();
    useFake(fake);
    const { db } = openTestDb();
    await expect(pushBackup({ db, cfg: testCfg({ repo: 'Asgh24/missing' }), log: () => {} })).rejects.toThrow(/was not found/i);
  });

  it('refuses a snapshot above the configured size limit', async () => {
    const fake = createFakeGithub();
    useFake(fake);
    const { db } = openTestDb();
    await expect(pushBackup({ db, cfg: testCfg({ repo: fake.full, maxBytes: 10 }), log: () => {} })).rejects.toThrow(/BACKUP_GITHUB_MAX_MB/);
    expect(fake.files.size).toBe(0);
  });

  it('lists and reads remote files through the real client', async () => {
    const fake = createFakeGithub();
    useFake(fake);
    const cfg = testCfg({ repo: fake.full });
    const { db } = openTestDb();
    await pushBackup({ db, cfg, log: () => {}, now: new Date('2026-10-18T07:30:00Z') });

    expect((await listSnapshots(createClientFor(cfg), cfg)).map((entry) => entry.name)).toEqual(['league-20261018T073000Z.db']);
    expect((await readManifest(createClientFor(cfg), cfg)).manifest.file).toBe('league-20261018T073000Z.db');

    const empty = testCfg({ repo: fake.full, dir: 'empty-dir' });
    expect(await readManifest(createClientFor(empty), empty)).toBeNull();
    expect(await listSnapshots(createClientFor(empty), empty)).toEqual([]);
  });

  it('surfaces a GitHub failure through the client without leaking the token', async () => {
    const fake = createFakeGithub();
    useFake(fake);
    const { db } = openTestDb();
    const cfg = testCfg({ repo: fake.full, token: 'super-secret-token' });
    const failing = {
      ...createClientFor(cfg),
      getRepo: () => Promise.reject(new Error('GitHub GET /repos failed (500): server error')),
    };
    const error = await pushBackup({ db, cfg, client: failing, log: () => {} }).catch((err) => err);
    expect(String(error.message)).toMatch(/server error/);
    expect(String(error.message)).not.toContain('super-secret-token');
    expect(fake.files.size).toBe(0);
  });
});

describe('backup scheduler', () => {
  it('computes when the next backup is due', () => {
    const now = new Date('2026-10-18T12:00:00Z').getTime();
    expect(msUntilDue({ lastSuccessAt: null, intervalMinutes: 60, now })).toBe(0);
    expect(msUntilDue({ lastSuccessAt: new Date('2026-10-18T11:30:00Z').toISOString(), intervalMinutes: 60, now })).toBe(30 * 60 * 1000);
    expect(msUntilDue({ lastSuccessAt: new Date('2026-10-18T10:00:00Z').toISOString(), intervalMinutes: 60, now })).toBe(0);
    expect(msUntilDue({ lastSuccessAt: 'garbage', intervalMinutes: 60, now })).toBe(0);
  });

  it('skips a tick that is not due yet and uploads once the interval elapsed', async () => {
    const fake = createFakeGithub();
    useFake(fake);
    const cfg = testCfg({ repo: fake.full });
    const { db } = openTestDb();
    const stateFile = tempStateFile();

    let clock = new Date('2026-10-18T12:00:00Z').getTime();
    const uploaded = [];
    const scheduler = createBackupScheduler({
      cfg,
      log: () => {},
      stateFile,
      now: () => clock,
      runBackup: async () => {
        const result = await pushBackup({ db, cfg, log: () => {}, now: new Date(clock) });
        uploaded.push(result.file);
        return result;
      },
    });

    const first = await scheduler.tick();
    expect(first.backedUp).toBe(true);
    expect(uploaded).toHaveLength(1);
    expect(readState(stateFile).lastSuccessAt).toBe(new Date(clock).toISOString());

    clock += 30 * 60 * 1000;
    expect(await scheduler.tick()).toMatchObject({ skipped: true });
    expect(uploaded).toHaveLength(1);

    clock += 31 * 60 * 1000;
    expect(await scheduler.tick()).toMatchObject({ backedUp: true });
    expect(uploaded).toHaveLength(2);
    expect(uploaded[0]).not.toBe(uploaded[1]);
    expect(fake.commits.filter((commit) => commit.path.endsWith(MANIFEST_NAME))).toHaveLength(2);
  });

  it('accepts the structured logger object the server passes in', async () => {
    const fake = createFakeGithub();
    useFake(fake);
    const cfg = testCfg({ repo: fake.full });
    const { db } = openTestDb();
    const emissions = [];
    const log = { info: (message) => emissions.push(message), warn: () => {}, error: () => {} };

    const scheduler = createBackupScheduler({
      cfg,
      log,
      stateFile: tempStateFile(),
      runBackup: () => pushBackup({ db, cfg, log: (message) => emissions.push(message) }),
    });

    const result = await scheduler.tick();
    expect(result.backedUp).toBe(true);
    expect(emissions).toContain('scheduled GitHub backup complete');
    expect(emissions).toContain('backup pushed to GitHub');
    expect(fake.files.size).toBe(2);
    scheduler.stop();
  });

  it('records the failure and retries instead of stopping', async () => {
    const stateFile = tempStateFile();
    const errors = [];
    const log = Object.assign(() => {}, { error: (message) => errors.push(message), warn: () => {} });
    const scheduler = createBackupScheduler({
      cfg: testCfg({ intervalMinutes: 1440 }),
      log,
      stateFile,
      runBackup: async () => {
        throw new Error('network down');
      },
    });

    const result = await scheduler.tick();
    expect(result).toMatchObject({ backedUp: false, error: 'network down' });
    expect(readState(stateFile).lastError).toBe('network down');
    expect(readState(stateFile).lastSuccessAt).toBeUndefined();
    expect(errors).toEqual(['scheduled GitHub backup failed']);
    scheduler.stop();
  });

  it('does nothing when the feature is disabled', async () => {
    const started = createBackupScheduler({ cfg: testCfg({ enabled: false }), log: () => {}, runBackup: async () => ({}) }).start();
    expect(await started.tick()).toEqual({ skipped: true, reason: 'disabled' });
    started.stop();
  });

  it('warns instead of scheduling when the repository is not configured', () => {
    const warnings = [];
    const log = Object.assign(() => {}, { warn: (message, fields) => warnings.push({ message, fields }), error: () => {} });
    const started = createBackupScheduler({ cfg: testCfg({ repo: '', token: '' }), log, runBackup: async () => ({}) }).start();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/not configured/i);
    expect(warnings[0].fields.missing).toEqual(['BACKUP_GITHUB_REPO', 'BACKUP_GITHUB_TOKEN']);
    started.stop();
  });

  it('writes and reads scheduler state', () => {
    const file = tempStateFile();
    expect(readState(file)).toEqual({});
    writeState({ lastSuccessAt: '2026-10-18T00:00:00.000Z' }, file);
    expect(readState(file).lastSuccessAt).toBe('2026-10-18T00:00:00.000Z');
    expect(readState(path.join(file, 'nope', 'missing.json'))).toEqual({});
  });
});
