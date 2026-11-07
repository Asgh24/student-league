import { Router } from 'express';
import { config } from '../config.js';
import { listPlans } from '../services/subscription.js';

/** Public, unauthenticated metadata used to brand the single page shell. */
export function createMetaRouter({ db, version = '1.0.0' }) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      appName: config.appName,
      version,
      timezoneOffsetMinutes: config.tzOffsetMinutes,
      likesPerDay: config.limits.likesPerDay,
      maxUploadBytes: config.limits.maxUploadBytes,
      trialDays: config.trialDays,
      paymentProvider: config.payments.provider,
      // Subscription storefront shown on the public landing page. Only active
      // plans are exposed; guests cannot see drafts the admin is preparing.
      plans: listPlans(db, { activeOnly: true }),
    });
  });

  return router;
}
