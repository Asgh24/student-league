import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'scl-setup-'));

// The application reads configuration lazily, so setting the environment here
// (before any test file imports the app) is enough to isolate every run.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough';
process.env.SEED_ENABLED = 'false';
process.env.LOGIN_RATE_LIMIT = process.env.LOGIN_RATE_LIMIT || '500';
process.env.API_RATE_LIMIT = process.env.API_RATE_LIMIT || '10000';
process.env.APP_TZ_OFFSET_MINUTES = process.env.APP_TZ_OFFSET_MINUTES || '210';
process.env.DATA_DIR = process.env.DATA_DIR || dataDir;

// Tests must not inherit the developer's local `.env` (dotenv loads it when
// `src/config.js` is first imported). Point dotenv at a file that cannot exist
// so runs are identical with or without a local `.env`.
process.env.DOTENV_CONFIG_PATH = path.join(dataDir, '.env-does-not-exist');
