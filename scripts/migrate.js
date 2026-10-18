import { ensureDirs } from '../src/config.js';
import { closeDatabase, openDatabase } from '../src/db.js';
import { logger } from '../src/logger.js';
import { migrationStatus, runMigrations } from '../src/migrate.js';
import { migrations } from '../src/migrations/index.js';

/** CLI: applies all pending migrations (`npm run migrate`). */
ensureDirs();
const db = openDatabase();
try {
  const result = runMigrations(db, migrations);
  if (result.ran.length === 0) {
    logger.info('no pending migrations');
  }
  for (const row of migrationStatus(db, migrations)) {
    logger.info('migration state', row);
  }
} catch (err) {
  logger.error('migration failed', { error: String(err?.message || err) });
  process.exitCode = 1;
} finally {
  closeDatabase(db);
}
