import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The application reads configuration lazily, so setting the environment here
// (before any test file imports the app) is enough to isolate every run.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough';
process.env.SEED_ENABLED = 'false';
process.env.LOGIN_RATE_LIMIT = process.env.LOGIN_RATE_LIMIT || '500';
process.env.API_RATE_LIMIT = process.env.API_RATE_LIMIT || '10000';
process.env.APP_TZ_OFFSET_MINUTES = process.env.APP_TZ_OFFSET_MINUTES || '210';
process.env.DATA_DIR = process.env.DATA_DIR || mkdtempSync(path.join(os.tmpdir(), 'scl-setup-'));
