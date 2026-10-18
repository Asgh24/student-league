import { Router } from 'express';
import { config } from '../config.js';
import { databaseStatus } from '../db.js';

export function createHealthRouter({ db, version = '1.0.0' }) {
  const router = Router();

  router.get('/', (_req, res) => {
    const status = databaseStatus(db);
    res.status(status.ok ? 200 : 503).json({
      status: status.ok ? 'ok' : 'degraded',
      app: config.appName,
      version,
      env: config.env,
      database: { ok: status.ok, integrity: status.integrity },
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    });
  });

  return router;
}
