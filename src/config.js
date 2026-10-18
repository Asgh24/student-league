import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Configuration is exposed through lazy getters so that the process environment
 * can be adjusted (by tests or by the CLI scripts) before values are read.
 */
export const config = {
  get env() {
    return process.env.NODE_ENV || 'development';
  },
  get isProd() {
    return this.env === 'production';
  },
  get isTest() {
    return this.env === 'test';
  },
  get port() {
    return int(process.env.PORT, 3000);
  },
  get host() {
    return process.env.HOST || '0.0.0.0';
  },
  get appName() {
    return process.env.APP_NAME || 'لیگ جامع دانش‌آموزی';
  },
  get dataDir() {
    return path.resolve(process.env.DATA_DIR || './data');
  },
  get dbFile() {
    return path.join(this.dataDir, 'league.db');
  },
  get uploadsDir() {
    return path.join(this.dataDir, 'uploads');
  },
  get backupsDir() {
    return path.join(this.dataDir, 'backups');
  },
  get sessionSecret() {
    const secret = process.env.SESSION_SECRET;
    if (secret && secret.length >= 16) return secret;
    if (this.isProd) {
      throw new Error('SESSION_SECRET must be set to a value of at least 16 characters in production');
    }
    return 'dev-only-insecure-session-secret-please-change';
  },
  get sessionCookieName() {
    return process.env.SESSION_COOKIE_NAME || 'scl.sid';
  },
  get sessionMaxAgeMs() {
    return int(process.env.SESSION_MAX_AGE_MS, 7 * 24 * 60 * 60 * 1000);
  },
  get trustProxy() {
    // Fail closed: only trust X-Forwarded-* when the deployment explicitly opts
    // in. Trusting it by default in production lets a directly exposed server be
    // reached through a spoofed X-Forwarded-For, which defeats IP rate limiting.
    return bool(process.env.TRUST_PROXY, false);
  },
  /** Minutes east of UTC used for "today" calculations (Iran is UTC+03:30). */
  get tzOffsetMinutes() {
    return int(process.env.APP_TZ_OFFSET_MINUTES, 210);
  },
  get seed() {
    return {
      teacherUser: process.env.SEED_TEACHER_USER || 'teacher',
      teacherPass: process.env.SEED_TEACHER_PASS || 'teacher1234',
      enabled: bool(process.env.SEED_ENABLED, !this.isProd),
      demoPassword: process.env.SEED_DEMO_PASS || 'student1234',
    };
  },
  get limits() {
    return {
      loginPerWindow: int(process.env.LOGIN_RATE_LIMIT, 10),
      apiPerWindow: int(process.env.API_RATE_LIMIT, 1200),
      windowMs: int(process.env.RATE_WINDOW_MS, 15 * 60 * 1000),
      maxUploadBytes: int(process.env.MAX_UPLOAD_BYTES, 10 * 1024 * 1024),
      likesPerDay: int(process.env.LIKES_PER_DAY, 10),
      bodyLimit: process.env.BODY_LIMIT || '512kb',
    };
  },
  get logLevel() {
    return process.env.LOG_LEVEL || (this.isProd ? 'info' : 'debug');
  },
};

export const ALLOWED_UPLOAD_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp3', '.mp4', '.zip', '.rar', '.7z',
];

export function ensureDirs() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function assertProductionSecrets() {
  if (config.isProd) {
    // Throws when SESSION_SECRET is missing/short. Called once at boot.
    void config.sessionSecret;
  }
}
