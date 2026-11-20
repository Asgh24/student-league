import { Router } from 'express';
import { config } from '../config.js';
import { databaseStatus } from '../db.js';

export function createHealthRouter({ db, version = '1.0.0', release = 'development' }) {
  const router = Router();

  // Tiny public endpoint polled by open browser tabs. It deliberately avoids
  // sessions and database work and must never be cached across deployments.
  router.get('/version', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ version, release });
  });

  router.get('/', (_req, res) => {
    const status = databaseStatus(db);
    res.status(status.ok ? 200 : 503).json({
      status: status.ok ? 'ok' : 'degraded',
      app: config.appName,
      version,
      release,
      env: config.env,
      database: { ok: status.ok, integrity: status.integrity },
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    });
  });

  return router;
}
