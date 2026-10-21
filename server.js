import { config, ensureDirs } from './src/config.js';
import { closeDatabase, openDatabase } from './src/db.js';
import { logger } from './src/logger.js';
import { runMigrations } from './src/migrate.js';
import { migrations } from './src/migrations/index.js';
import { createApp, publicDir } from './src/app.js';
import { createSessionStore, startSessionSweep } from './src/middleware/session.js';
import { runSeed } from './src/seed.js';
import { runAdminBootstrap, runBootstrap } from './src/bootstrap.js';
import { APP_VERSION } from './src/version.js';
import { createClientFor, isConfigured, pushBackup, restoreOnBoot } from './src/services/githubBackup.js';
import { createBackupScheduler } from './src/services/backupScheduler.js';

const logBackup = (message, fields) => logger.info(message, fields);

async function boot() {
  ensureDirs();
  let db = openDatabase();

  // Recovery runs before the first migration writes to an empty file: a PaaS
  // container can come back with a wiped filesystem, and the newest GitHub
  // snapshot is then the only copy of the class data.
  const recovery = await restoreOnBoot({ db, log: logBackup });
  db = recovery.db;
  if (recovery.reason === 'failed') logger.warn('continuing with an empty local database', { error: recovery.error });

  const applied = runMigrations(db, migrations);
  if (applied.ran.length > 0) logger.info('database ready', { applied: applied.ran });

  // Production has no demo seed, so an empty database gets its first teacher here.
  if (config.bootstrap.enabled) {
    const result = runBootstrap(db, { log: logBackup });
    if (result.reason === 'invalid-config') logger.warn('no teacher account exists yet', { reason: result.problem });
  }

  // The site owner can exist even when teachers already do (unlike the first
  // teacher bootstrap, which only touches an empty users table).
  const adminResult = runAdminBootstrap(db, { log: logBackup });
  if (adminResult.reason === 'invalid-config') logger.warn('no admin account exists yet', { reason: adminResult.problem });

  // Demo data is generated automatically outside production when the DB is empty.
  const hasUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
  const seedOnBoot = !config.isProd && config.seed.enabled && process.env.SEED_ON_BOOT !== 'false' && !hasUsers;
  if (seedOnBoot) {
    logger.info('seeding demo data (development only)');
    runSeed(db, { log: (message) => logger.info(message) });
  }

  const sessionStore = createSessionStore(db);
  const app = createApp({ db, version: APP_VERSION, sessionStore });
  const sweepTimer = startSessionSweep(sessionStore, {
    onSweep: (removed) => logger.info('expired sessions removed', { removed }),
  });

  const backupCfg = config.githubBackup;
  const scheduler = createBackupScheduler({
    cfg: backupCfg,
    log: logger,
    runBackup: () =>
      pushBackup({ db, cfg: backupCfg, client: createClientFor(backupCfg), log: logBackup, appVersion: APP_VERSION }),
  }).start();
  if (backupCfg.enabled && !isConfigured(backupCfg)) {
    logger.warn('GitHub backup is enabled but incomplete; set BACKUP_GITHUB_REPO and BACKUP_GITHUB_TOKEN', {
      repo: backupCfg.repo || null,
      hasToken: Boolean(backupCfg.token),
    });
  }

  const server = app.listen(config.port, config.host, () => {
    logger.info('server listening', {
      port: config.port,
      host: config.host,
      env: config.env,
      app: config.appName,
      version: APP_VERSION,
      dataDir: config.dataDir,
      staticDir: publicDir,
    });
  });

  server.on('error', (err) => {
    logger.error('server error', { error: String(err?.message || err) });
    process.exitCode = 1;
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });
    const force = setTimeout(() => {
      logger.warn('forcing exit after timeout');
      process.exit(1);
    }, 10000);
    force.unref();
    server.close(() => {
      clearInterval(sweepTimer);
      scheduler.stop();
      closeDatabase(db);
      logger.info('shutdown complete');
      clearTimeout(force);
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', { error: String(reason) });
  });

  return server;
}

boot().catch((err) => {
  logger.error('boot failed', { error: String(err?.message || err) });
  process.exit(1);
});
