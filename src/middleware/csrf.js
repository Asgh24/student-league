import crypto from 'node:crypto';
import { csrfError, forbidden } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Makes sure the session carries a CSRF token and exposes it on the request. */
export function ensureCsrfToken(req, _res, next) {
  if (!req.session) return next(forbidden('نشست نامعتبر است'));
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  req.csrfToken = req.session.csrfToken;
  return next();
}

/**
 * Synchronizer-token CSRF protection. State changing requests must echo the
 * token in the `x-csrf-token` header (or `_csrf` body field).
 */
export function csrfProtection(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const expected = req.session && req.session.csrfToken;
  const provided = req.get('x-csrf-token') || (req.body && req.body._csrf);
  if (!expected || !provided || !safeEqual(provided, expected)) {
    return next(csrfError());
  }
  return next();
}
