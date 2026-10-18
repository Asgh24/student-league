import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { logger } from '../src/logger.js';

/**
 * CLI: `npm run backup`
 * Uses the SQLite online backup API through better-sqlite3 so the snapshot is
 * consistent even while the application is running. Backups are written next to
 * the live database inside DATA_DIR/backups by default.
 */
function stamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function backup() {
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

await backup();
