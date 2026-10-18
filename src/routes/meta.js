import { Router } from 'express';
import { config } from '../config.js';

/** Public, unauthenticated metadata used to brand the single page shell. */
export function createMetaRouter({ version = '1.0.0' }) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      appName: config.appName,
      version,
      timezoneOffsetMinutes: config.tzOffsetMinutes,
      likesPerDay: config.limits.likesPerDay,
      maxUploadBytes: config.limits.maxUploadBytes,
    });
  });

  return router;
}
