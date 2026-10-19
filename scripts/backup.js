import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { logger } from '../src/logger.js';
import { APP_VERSION } from '../src/version.js';
import { backupStatus, isConfigured, pushBackup } from '../src/services/githubBackup.js';

/**
 * CLI:
 *   npm run backup              local snapshot into $BACKUP_DIR (or DATA_DIR/backups)
 *   npm run backup:github       snapshot uploaded to the configured GitHub repo
 *   npm run backup:github -- --status   show what is stored remotely
 *
 * Snapshots use the SQLite online backup API through better-sqlite3, so they are
 * consistent even while the application is running.
 */
function stamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function localBackup() {
  ensureDirs();
  const targetDir = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : config.backupsDir;
  fs.mkdirSync(targetDir, { recursive: true });
  const targetFile = path.join(targetDir, `league-${stamp()}.db`);

  if (!fs.existsSync(config.dbFile)) {
    logger.error('database file not found', { file: config.dbFile });
    process.exitCode = 1;
    return;
  }

  const db = openDatabase();
  try {
    await db.backup(targetFile);
    const size = fs.statSync(targetFile).size;
    logger.info('backup written', { file: targetFile, bytes: size });
  } catch (err) {
    logger.error('backup failed', { error: String(err?.message || err) });
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

async function githubBackup() {
  ensureDirs();
  const cfg = config.githubBackup;
  if (!isConfigured(cfg)) {
    logger.error('GitHub backup is not configured', {
      hint: 'set BACKUP_GITHUB_ENABLED=true, BACKUP_GITHUB_REPO=owner/repo and BACKUP_GITHUB_TOKEN',
    });
    process.exitCode = 1;
    return;
  }

  const db = openDatabase();
  try {
    const result = await pushBackup({ db, cfg, log: (message, fields) => logger.info(message, fields), appVersion: APP_VERSION });
    logger.info('GitHub backup finished', { file: result.file, bytes: result.bytes, sha256: result.sha256, pruned: result.pruned });
  } catch (err) {
    logger.error('GitHub backup failed', { error: String(err?.message || err) });
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

async function githubStatus() {
  const cfg = config.githubBackup;
  if (!isConfigured(cfg)) {
    logger.error('GitHub backup is not configured', { hint: 'set BACKUP_GITHUB_REPO and BACKUP_GITHUB_TOKEN' });
    process.exitCode = 1;
    return;
  }
  try {
    const status = await backupStatus({ cfg });
    logger.info('GitHub backup status', {
      repo: status.repo,
      branch: status.branch,
      dir: status.dir,
      snapshots: status.snapshots,
      newest: status.newest,
      lastBackupAt: status.manifest?.createdAt ?? null,
      lastBackupBytes: status.manifest?.bytes ?? null,
      lastBackupSha256: status.manifest?.sha256 ?? null,
    });
  } catch (err) {
    logger.error('GitHub status failed', { error: String(err?.message || err) });
    process.exitCode = 1;
  }
}

if (process.argv.includes('--status')) {
  await githubStatus();
} else if (process.argv.includes('--github')) {
  await githubBackup();
} else {
  await localBackup();
}
