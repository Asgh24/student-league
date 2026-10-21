import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { createApiRouter } from './routes/index.js';
import { createHealthRouter } from './routes/health.js';
import { createPaymentRouter } from './routes/payments.js';
import { attachUser } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiRateLimit } from './middleware/rateLimit.js';
import { createSessionStore, sessionMiddleware } from './middleware/session.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');

/**
 * Builds the Express application. The same process serves the JSON API and the
 * static single page frontend, so it can run on any plain Node.js host.
 */
export function createApp({ db, version = '1.0.0', sessionStore = createSessionStore(db) }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          // The «سرگرمی» tab embeds neal.fun; everything else stays same-origin.
          frameSrc: ["'self'", 'https://neal.fun', 'https://*.neal.fun'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(express.json({ limit: config.limits.bodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.limits.bodyLimit }));

  // Static assets are served before the session middleware so that asset
  // requests never create a session row.
  app.use(
    express.static(publicDir, {
      index: 'index.html',
      etag: true,
      lastModified: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
        else res.setHeader('Cache-Control', config.isProd ? 'public, max-age=2592000' : 'no-cache');
      },
    }),
  );

  app.use('/healthz', createHealthRouter({ db, version }));

  // Payment provider redirects arrive here. They are deliberately outside
  // `/api/v1` (no CSRF/JSON middleware) and before the SPA fallback.
  app.use('/payments', createPaymentRouter({ db }));

  app.use(sessionMiddleware(sessionStore));
  // No global CSRF-token middleware: only the auth endpoints need a token before
  // a session exists, and they install it themselves. Keeping it off the global
  // chain means anonymous page views never write a session row.
  app.use(attachUser(db));

  app.use('/api/v1', apiRateLimit(), csrfProtection, createApiRouter({ db }));
  app.use('/api', notFoundHandler);

  // Hash routing keeps the SPA on "/", this fallback only helps deep links.
  app.get(/.*/, (req, res, next) => {
    if (!req.accepts('html')) return next();
    return res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use(errorHandler);
  return app;
}

export { publicDir, rootDir };
