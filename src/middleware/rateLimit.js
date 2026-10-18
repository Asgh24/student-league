import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

const handler = (_req, res) => {
  res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message: 'تلاش‌های شما بیش از حد مجاز است. کمی بعد دوباره امتحان کنید' } });
};

/** Broad limiter applied to the whole API. */
export function apiRateLimit() {
  return rateLimit({
    windowMs: config.limits.windowMs,
    limit: config.limits.apiPerWindow,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler,
  });
}

/** Stricter limiter for credential endpoints (brute force protection). */
export function loginRateLimit() {
  return rateLimit({
    windowMs: config.limits.windowMs,
    limit: config.limits.loginPerWindow,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler,
  });
}
