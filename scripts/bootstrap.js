import { config, ensureDirs } from '../src/config.js';
import { closeDatabase, openDatabase } from '../src/db.js';
import { logger } from '../src/logger.js';
import { runMigrations } from '../src/migrate.js';
import { migrations } from '../src/migrations/index.js';
import { bootstrapProblem, runBootstrap } from '../src/bootstrap.js';

/**
 * CLI: `npm run bootstrap` - create the first teacher account, or with
 * `npm run bootstrap -- --force` reset the password of that account when it was
 * forgotten. This is the production replacement for `npm run seed`, which
 * inserts 22 fake students and is refused on a production database.
 */
const force = process.argv.includes('--force');

ensureDirs();
const db = openDatabase();
try {
  runMigrations(db, migrations);

  const problem = bootstrapProblem();
  if (problem) {
    logger.error('bootstrap skipped', { reason: problem });
    process.exitCode = 1;
  } else {
    if (force) logger.warn('--force resets the password of an existing account');
    const result = runBootstrap(db, { force, log: (message, fields) => logger.info(message, fields) });
    logger.info('bootstrap summary', result);
    if (!result.created && !result.updated && result.reason === 'database-already-has-users') {
      logger.info('nothing to do: the database already has accounts (use --force to reset the teacher password)');
    }
  }
} catch (err) {
  logger.error('bootstrap failed', { error: String(err?.message || err) });
  process.exitCode = 1;
} finally {
  closeDatabase(db);
}

if (config.isProd) logger.info('remember to remove BOOTSTRAP_TEACHER_PASS from the environment once you are logged in');
