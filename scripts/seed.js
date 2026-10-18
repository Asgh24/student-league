import { config, ensureDirs } from '../src/config.js';
import { closeDatabase, openDatabase } from '../src/db.js';
import { logger } from '../src/logger.js';
import { runMigrations } from '../src/migrate.js';
import { migrations } from '../src/migrations/index.js';
import { runSeed } from '../src/seed.js';

/** CLI: `npm run seed` - idempotent demo data, refuses to run in production. */
if (config.isProd && process.env.SEED_FORCE !== 'true') {
  logger.error('refusing to seed a production database (set SEED_FORCE=true to override)');
  process.exit(1);
}

ensureDirs();
const db = openDatabase();
try {
  runMigrations(db, migrations);
  const summary = runSeed(db, { log: (message) => logger.info(message) });
  logger.info('seed summary', summary);
  logger.info('demo credentials', {
    teacher: { username: config.seed.teacherUser, password: config.seed.teacherPass },
    student: { username: 'student1', password: config.seed.demoPassword },
  });
} catch (err) {
  logger.error('seed failed', { error: String(err?.message || err) });
  process.exitCode = 1;
} finally {
  closeDatabase(db);
}
