import Database from 'better-sqlite3';
import { config, ensureDirs } from './config.js';
import { logger } from './logger.js';

/**
 * Opens a SQLite database with the pragmas this application relies on:
 * WAL for concurrent reads, enforced foreign keys and a busy timeout.
 */
export function openDatabase(file = config.dbFile) {
  ensureDirs();
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

const INTEGRITY_TTL_MS = 5 * 60 * 1000;
let integrity = { at: 0, value: null };

/**
 * Cheap liveness probe. `PRAGMA quick_check` walks the whole database, so its
 * result is cached: `/healthz` is unauthenticated and unrated, and without a
 * cache a caller could turn it into a CPU/disk amplifier on a large database.
 */
export function databaseStatus(db) {
  try {
    const row = db.prepare('SELECT 1 AS ok').get();
    const now = Date.now();
    if (integrity.value === null || now - integrity.at > INTEGRITY_TTL_MS) {
      const checked = db.pragma('quick_check', { simple: true });
      integrity = { at: now, value: checked === 'ok' ? 'ok' : String(checked) };
    }
    return { ok: row?.ok === 1, integrity: integrity.value };
  } catch (err) {
    return { ok: false, integrity: 'error', message: String(err?.message || err) };
  }
}

/** Runs `fn` inside an immediate SQLite transaction. */
export function transaction(db, fn) {
  return db.transaction(fn)();
}

export function closeDatabase(db) {
  if (!db || !db.open) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    logger.warn('wal checkpoint failed during close', { error: String(err?.message || err) });
  }
  db.close();
}

export { Database };
