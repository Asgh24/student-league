import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { createGithubClient, isNotFound } from '../lib/github.js';
import { openDatabase } from '../db.js';

/**
 * Off-site backups: take a consistent snapshot of the SQLite file and store it
 * in a GitHub repository through the Contents API.
 *
 * On managed PaaS the container filesystem is recreated on every redeploy, so a
 * local snapshot is not a backup. This module is the durability layer: the
 * newest snapshot is written next to a small `latest.json` manifest, older
 * snapshots are pruned, and an empty local database can be restored on boot.
 *
 * The database normally holds personal data (student names, marks, attendance),
 * so a public target repository is refused unless it is explicitly allowed.
 */
export const MANIFEST_NAME = 'latest.json';
export const RESTORE_MARKER_NAME = 'restore-request.json';

export function isConfigured(cfg = config.githubBackup) {
  return Boolean(cfg.repo && cfg.token);
}

export function missingSettings(cfg = config.githubBackup) {
  const missing = [];
  if (!cfg.repo) missing.push('BACKUP_GITHUB_REPO');
  if (!cfg.token) missing.push('BACKUP_GITHUB_TOKEN');
  return missing;
}

/** Safe for logs: identifies the target without exposing the token. */
export function describeConfig(cfg = config.githubBackup) {
  return {
    repo: cfg.repo || null,
    branch: cfg.branch,
    dir: cfg.dir,
    intervalMinutes: cfg.intervalMinutes,
    keep: cfg.keep,
  };
}

export function createClientFor(cfg = config.githubBackup) {
  return createGithubClient({ token: cfg.token, apiBaseUrl: cfg.apiBaseUrl });
}

/** `20261018T221500Z` — sorts lexicographically and is safe in a file name. */
export function backupStamp(date = new Date()) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}T${iso.slice(11, 19).replace(/:/g, '')}Z`;
}

export function joinRemote(dir, name) {
  return dir ? `${dir}/${name}` : name;
}

/** Consistent copy of the live database on disk (safe while the server runs). */
export async function snapshotDatabase(db, targetFile) {
  await db.backup(targetFile);
  const bytes = await fsp.readFile(targetFile);
  return {
    file: targetFile,
    size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    base64: bytes.toString('base64'),
  };
}

/** Reads one file from the backup directory, or `null` when it does not exist. */
export async function readRemoteFile(client, cfg, name) {
  try {
    const entry = await client.getContents(cfg.repo, joinRemote(cfg.dir, name), cfg.branch);
    if (!entry || Array.isArray(entry)) return null;
    // The Contents API only inlines files up to 1 MB. Larger snapshots report
    // `encoding: "none"` and must be read through the Git Blob API.
    if (entry.encoding === 'base64' && entry.content) {
      return { name, sha: entry.sha, buffer: Buffer.from(entry.content, 'base64') };
    }
    if (entry.sha && typeof client.getBlob === 'function') {
      const blob = await client.getBlob(cfg.repo, entry.sha);
      if (blob?.encoding === 'base64' && blob.content) {
        return { name, sha: entry.sha, buffer: Buffer.from(blob.content, 'base64') };
      }
    }
    return { name, sha: entry.sha, buffer: null };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function readManifest(client, cfg) {
  const file = await readRemoteFile(client, cfg, MANIFEST_NAME);
  if (!file?.buffer) return null;
  try {
    return { sha: file.sha, manifest: JSON.parse(file.buffer.toString('utf8')) };
  } catch {
    return { sha: file.sha, manifest: null };
  }
}

/** Snapshot files in the backup directory, oldest first. */
export async function listSnapshots(client, cfg) {
  let entries;
  try {
    entries = await client.getContents(cfg.repo, cfg.dir, cfg.branch);
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => entry.type === 'file' && /\.db$/.test(entry.name))
    .map((entry) => ({ name: entry.name, sha: entry.sha, size: entry.size ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Keeps the newest `cfg.keep` snapshots; `0` keeps everything. Returns the removed names. */
export async function pruneSnapshots(client, cfg, log = () => {}) {
  if (!cfg.keep) return [];
  const snapshots = await listSnapshots(client, cfg);
  const excess = snapshots.length - cfg.keep;
  if (excess <= 0) return [];
  const remove = snapshots.slice(0, excess);
  const removed = [];
  for (const snapshot of remove) {
    await client.deleteFile(cfg.repo, joinRemote(cfg.dir, snapshot.name), {
      message: `chore(backup): prune ${snapshot.name}`,
      sha: snapshot.sha,
      branch: cfg.branch,
    });
    removed.push(snapshot.name);
    log('pruned old snapshot', { file: snapshot.name });
  }
  return removed;
}

async function assertWritableTarget(client, cfg) {
  let repo;
  try {
    repo = await client.getRepo(cfg.repo);
  } catch (err) {
    if (isNotFound(err)) {
      throw new Error(
        `GitHub repository "${cfg.repo}" was not found. Check BACKUP_GITHUB_REPO and that BACKUP_GITHUB_TOKEN grants it "Contents: read and write".`,
      );
    }
    throw err;
  }
  if (!repo.private && !cfg.allowPublicRepo) {
    throw new Error(
      `refusing to back up to the public repository "${cfg.repo}": the snapshot contains student data. ` +
        'Use a private repository, or set BACKUP_GITHUB_ALLOW_PUBLIC=true if you really mean it.',
    );
  }
  return repo;
}

function schemaMigrationCount(db) {
  try {
    return db.prepare('SELECT COUNT(*) AS n FROM _migrations').get().n;
  } catch {
    return null;
  }
}

/**
 * Snapshots the database and uploads it as `<dir>/<prefix>-<stamp>.db`, then
 * refreshes `<dir>/latest.json` and prunes older snapshots.
 */
export async function pushBackup({ db, cfg = config.githubBackup, client = createClientFor(cfg), log = () => {}, now = new Date(), appVersion = null } = {}) {
  if (!isConfigured(cfg)) {
    throw new Error(`GitHub backup is not configured (missing ${missingSettings(cfg).join(', ')})`);
  }
  await assertWritableTarget(client, cfg);

  const stamp = backupStamp(now);
  const fileName = `${cfg.filePrefix}-${stamp}.db`;
  const tempFile = path.join(path.dirname(config.dbFile), `.${fileName}.tmp`);

  let snapshot;
  try {
    snapshot = await snapshotDatabase(db, tempFile);
  } finally {
    await fsp.rm(tempFile, { force: true });
  }

  if (snapshot.size > cfg.maxBytes) {
    throw new Error(
      `snapshot is ${(snapshot.size / 1024 / 1024).toFixed(1)} MB, above BACKUP_GITHUB_MAX_MB=${Math.round(cfg.maxBytes / 1024 / 1024)}; ` +
        'raise the limit (GitHub rejects files over 100 MB) or exclude large uploads from DATA_DIR.',
    );
  }

  const uploaded = await client.putFile(cfg.repo, joinRemote(cfg.dir, fileName), {
    contentBase64: snapshot.base64,
    message: `chore(backup): ${fileName}`,
    branch: cfg.branch,
  });

  const manifest = {
    file: fileName,
    bytes: snapshot.size,
    sha256: snapshot.sha256,
    createdAt: now.toISOString(),
    appVersion,
    schemaMigrations: schemaMigrationCount(db),
  };
  const previous = await readManifest(client, cfg);
  await client.putFile(cfg.repo, joinRemote(cfg.dir, MANIFEST_NAME), {
    contentBase64: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8').toString('base64'),
    message: `chore(backup): manifest for ${fileName}`,
    sha: previous?.sha,
    branch: cfg.branch,
  });

  const pruned = await pruneSnapshots(client, cfg, log);
  log('backup pushed to GitHub', { ...describeConfig(cfg), file: fileName, bytes: snapshot.size, sha256: snapshot.sha256, pruned });
  return { ...manifest, path: joinRemote(cfg.dir, fileName), commit: uploaded?.commit?.sha ?? null, pruned };
}

export function removeDatabaseFiles(databaseFile) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${databaseFile}${suffix}`, { force: true });
    } catch {
      /* best effort: the file may be locked on Windows, the write below then fails loudly */
    }
  }
}

/** True when the file behind an open connection already carries the application schema. */
export function databaseHasSchema(db) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'leagues') LIMIT 1")
    .get();
  return Boolean(row);
}

/**
 * True when the database has no application data yet (even if the schema was
 * created by a previous boot or by `npm run migrate`). A schema-only file is
 * exactly the state left behind by a deploy that crashed before bootstrap, so
 * the GitHub snapshot should still be allowed to replace it.
 */
export function databaseIsEmpty(db) {
  if (!databaseHasSchema(db)) return true;
  try {
    const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const leagues = db.prepare('SELECT COUNT(*) AS n FROM leagues').get().n;
    return users === 0 && leagues === 0;
  } catch {
    // A partial or corrupt schema is never safe to overwrite automatically.
    return false;
  }
}

/** Prevents a remote file name from escaping the backup directory. */
export function normalizeSnapshotName(name) {
  const value = String(name ?? '');
  const base = path.basename(value);
  if (base !== value || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.db$/.test(base)) {
    throw new Error(`invalid snapshot file name: ${value || '(empty)'}`);
  }
  return base;
}

function markerFileFor(databaseFile) {
  return path.join(path.dirname(databaseFile), RESTORE_MARKER_NAME);
}

function removeSidecars(file) {
  for (const suffix of ['-wal', '-shm']) {
    try {
      fs.rmSync(`${file}${suffix}`, { force: true });
    } catch {
      /* best effort */
    }
  }
}

/** Opens a snapshot read-only and verifies it is a complete SQLite app database. */
function validateSqliteSnapshot(file) {
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const check = db.pragma('quick_check', { simple: true });
    if (check !== 'ok') throw new Error(`SQLite integrity check failed: ${check}`);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users' LIMIT 1")
      .get();
    if (!row) throw new Error('snapshot does not contain the application schema');
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
    removeSidecars(file);
  }
}

/** Reads the staged-restore marker without throwing when it is absent or invalid. */
export async function readRestoreMarker({ databaseFile = config.dbFile } = {}) {
  try {
    const data = JSON.parse(await fsp.readFile(markerFileFor(databaseFile), 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

/** Removes a staged snapshot and its marker. */
export async function cancelStagedRestore({ databaseFile = config.dbFile } = {}) {
  const marker = await readRestoreMarker({ databaseFile });
  if (marker?.stagedFile) {
    await fsp.rm(marker.stagedFile, { force: true }).catch(() => {});
    removeSidecars(marker.stagedFile);
  }
  await fsp.rm(markerFileFor(databaseFile), { force: true }).catch(() => {});
  return { canceled: Boolean(marker) };
}

/**
 * Downloads a snapshot (the newest by default, or a named one) and stages it for
 * the next boot. The live database is never modified here: replacing SQLite
 * files under open statements is not safe, so `applyStagedRestore` runs before
 * the next `openDatabase()`.
 */
export async function stageRestore({
  cfg = config.githubBackup,
  client = createClientFor(cfg),
  databaseFile = config.dbFile,
  fileName = null,
  log = () => {},
  now = new Date(),
} = {}) {
  if (!isConfigured(cfg)) {
    throw new Error(`GitHub backup is not configured (missing ${missingSettings(cfg).join(', ')})`);
  }

  let manifest = null;
  let target;
  if (fileName) {
    target = normalizeSnapshotName(fileName);
    const snapshots = await listSnapshots(client, cfg);
    if (!snapshots.some((entry) => entry.name === target)) {
      return { staged: false, reason: 'snapshot-not-found', file: target };
    }
  } else {
    const remote = await readManifest(client, cfg);
    if (!remote?.manifest?.file) return { staged: false, reason: 'no-manifest' };
    target = normalizeSnapshotName(remote.manifest.file);
    manifest = remote.manifest;
  }

  const remoteFile = await readRemoteFile(client, cfg, target);
  if (!remoteFile?.buffer) return { staged: false, reason: 'snapshot-missing', file: target };
  if (remoteFile.buffer.length > cfg.maxBytes) {
    throw new Error(
      `snapshot ${target} is ${(remoteFile.buffer.length / 1024 / 1024).toFixed(1)} MB, above BACKUP_GITHUB_MAX_MB=${Math.round(cfg.maxBytes / 1024 / 1024)}`,
    );
  }

  const sha256 = crypto.createHash('sha256').update(remoteFile.buffer).digest('hex');
  if (manifest?.sha256 && sha256 !== manifest.sha256) {
    throw new Error(`checksum mismatch for ${target}: expected ${manifest.sha256}, got ${sha256}`);
  }

  await fsp.mkdir(path.dirname(databaseFile), { recursive: true });
  const markerFile = markerFileFor(databaseFile);
  const previousMarker = await readRestoreMarker({ databaseFile });
  if (previousMarker?.stagedFile && previousMarker.stagedFile !== databaseFile) {
    await fsp.rm(previousMarker.stagedFile, { force: true }).catch(() => {});
    removeSidecars(previousMarker.stagedFile);
  }

  const stagedFile = path.join(path.dirname(databaseFile), `.restore-${sha256.slice(0, 16)}.db`);
  removeSidecars(stagedFile);
  await fsp.writeFile(stagedFile, remoteFile.buffer);
  try {
    validateSqliteSnapshot(stagedFile);
  } catch (err) {
    await fsp.rm(stagedFile, { force: true }).catch(() => {});
    removeSidecars(stagedFile);
    throw new Error(`downloaded snapshot ${target} is not a valid application database: ${String(err?.message || err)}`);
  }

  const marker = {
    stagedFile,
    sourceFile: target,
    bytes: remoteFile.buffer.length,
    sha256,
    createdAt: manifest?.createdAt ?? null,
    requestedAt: now.toISOString(),
  };
  const tempMarker = `${markerFile}.tmp`;
  await fsp.writeFile(tempMarker, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  await fsp.rename(tempMarker, markerFile);
  log('database restore staged for next boot', {
    ...describeConfig(cfg),
    file: target,
    bytes: marker.bytes,
    sha256,
  });
  return { staged: true, ...marker, markerFile };
}

/**
 * Applies a marker written by `stageRestore`. Must run before the database is
 * opened; the previous file is kept until the rename succeeds, then removed.
 */
export async function applyStagedRestore({ databaseFile = config.dbFile, log = () => {} } = {}) {
  const marker = await readRestoreMarker({ databaseFile });
  if (!marker) return { applied: false, reason: 'no-marker' };

  const markerFile = markerFileFor(databaseFile);
  const stagedFile = path.resolve(String(marker.stagedFile || ''));
  const allowedDir = path.dirname(path.resolve(databaseFile));
  if (path.dirname(stagedFile) !== allowedDir || !stagedFile.endsWith('.db')) {
    await fsp.rm(markerFile, { force: true }).catch(() => {});
    return { applied: false, reason: 'invalid-marker' };
  }
  if (!fs.existsSync(stagedFile)) {
    await fsp.rm(markerFile, { force: true }).catch(() => {});
    return { applied: false, reason: 'staged-file-missing' };
  }

  const bytes = await fsp.readFile(stagedFile);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (marker.sha256 && sha256 !== marker.sha256) {
    await cancelStagedRestore({ databaseFile });
    return { applied: false, reason: 'checksum-mismatch' };
  }
  try {
    validateSqliteSnapshot(stagedFile);
  } catch (err) {
    await cancelStagedRestore({ databaseFile });
    return { applied: false, reason: 'invalid-snapshot', error: String(err?.message || err) };
  }

  const previousFile = `${databaseFile}.before-restore`;
  removeSidecars(databaseFile);
  await fsp.rm(previousFile, { force: true }).catch(() => {});
  if (fs.existsSync(databaseFile)) await fsp.rename(databaseFile, previousFile);
  try {
    await fsp.rename(stagedFile, databaseFile);
  } catch (err) {
    if (fs.existsSync(previousFile)) await fsp.rename(previousFile, databaseFile).catch(() => {});
    throw err;
  }
  await fsp.rm(previousFile, { force: true }).catch(() => {});
  await fsp.rm(markerFile, { force: true }).catch(() => {});
  log('staged database restore applied', {
    file: marker.sourceFile ?? null,
    bytes: bytes.length,
    sha256,
  });
  return { applied: true, manifest: marker, sha256 };
}

/**
 * Downloads the snapshot named in the remote manifest and replaces the local
 * database file. The bytes are fetched and checksummed before anything is
 * deleted, so a failed download leaves the local database untouched.
 */
export async function restoreFromGithub({ cfg = config.githubBackup, client = createClientFor(cfg), databaseFile = config.dbFile, log = () => {}, open = openDatabase } = {}) {
  const remote = await readManifest(client, cfg);
  if (!remote?.manifest?.file) return { restored: false, reason: 'no-manifest' };

  const file = await readRemoteFile(client, cfg, remote.manifest.file);
  if (!file?.buffer) return { restored: false, reason: 'snapshot-missing' };

  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  if (remote.manifest.sha256 && sha256 !== remote.manifest.sha256) {
    throw new Error(`checksum mismatch for ${remote.manifest.file}: expected ${remote.manifest.sha256}, got ${sha256}`);
  }

  removeDatabaseFiles(databaseFile);
  await fsp.mkdir(path.dirname(databaseFile), { recursive: true });
  await fsp.writeFile(databaseFile, file.buffer);
  const db = open(databaseFile);
  log('database restored from GitHub', {
    ...describeConfig(cfg),
    file: remote.manifest.file,
    bytes: file.buffer.length,
    sha256,
    createdAt: remote.manifest.createdAt ?? null,
  });
  return { restored: true, db, manifest: remote.manifest, sha256 };
}

/**
 * Boot-time recovery: a database with no users or leagues is treated as empty,
 * which covers both a wiped container and a schema-only file left by a deploy
 * that stopped before bootstrap. A real database is never overwritten by an old
 * snapshot.
 */
export async function restoreOnBoot({ db, cfg = config.githubBackup, databaseFile = config.dbFile, log = () => {}, open = openDatabase, client = null } = {}) {
  if (!cfg.restoreOnEmpty) return { restored: false, db, reason: 'disabled' };
  if (!isConfigured(cfg)) {
    if (cfg.enabled) log('GitHub restore skipped: BACKUP_GITHUB_REPO and BACKUP_GITHUB_TOKEN are not both set');
    return { restored: false, db, reason: 'not-configured' };
  }
  if (!databaseIsEmpty(db)) return { restored: false, db, reason: 'local-database-has-data' };

  const api = client ?? createClientFor(cfg);
  db.close();
  let result;
  try {
    result = await restoreFromGithub({ cfg, client: api, databaseFile, log, open });
  } catch (err) {
    log('GitHub restore failed, starting from an empty local database', { error: String(err?.message || err) });
    return { restored: false, db: open(databaseFile), reason: 'failed', error: String(err?.message || err) };
  }
  if (!result.restored) return { restored: false, db: open(databaseFile), reason: result.reason };
  return { restored: true, db: result.db, manifest: result.manifest, reason: 'restored' };
}

/** Read-only summary used by `npm run backup:github -- --status` and the boot log. */
export async function backupStatus({ cfg = config.githubBackup, client = createClientFor(cfg) } = {}) {
  const remote = await readManifest(client, cfg);
  const snapshots = await listSnapshots(client, cfg);
  return { ...describeConfig(cfg), snapshots: snapshots.length, newest: snapshots.at(-1)?.name ?? null, manifest: remote?.manifest ?? null };
}
