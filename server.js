import { config, ensureDirs } from './src/config.js';
import { closeDatabase, openDatabase } from './src/db.js';
import { logger } from './src/logger.js';
import { runMigrations } from './src/migrate.js';
import { migrations } from './src/migrations/index.js';
import { createApp, publicDir } from './src/app.js';
import { createSessionStore, startSessionSweep } from './src/middleware/session.js';
import { runSeed } from './src/seed.js';

const VERSION = '1.0.0';

function boot() {
  ensureDirs();
  const db = openDatabase();
  const applied = runMigrations(db, migrations);
  if (applied.ran.length > 0) logger.info('database ready', { applied: applied.ran });

  // Demo data is generated automatically outside production when the DB is empty.
  const hasUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
  const seedOnBoot = !config.isProd && config.seed.enabled && process.env.SEED_ON_BOOT !== 'false' && !hasUsers;
  if (seedOnBoot) {
    logger.info('seeding demo data (development only)');
    runSeed(db, { log: (message) => logger.info(message) });
  }

  const sessionStore = createSessionStore(db);
  const app = createApp({ db, version: VERSION, sessionStore });
  const sweepTimer = startSessionSweep(sessionStore, {
    onSweep: (removed) => logger.info('expired sessions removed', { removed }),
  });
  const server = app.listen(config.port, config.host, () => {
    logger.info('server listening', {
      port: config.port,
      host: config.host,
      env: config.env,
      app: config.appName,
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

boot();
