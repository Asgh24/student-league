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
    // Sessions always live for 24 hours from the moment of login. `rolling` is
    // disabled in the session middleware so activity does not extend it.
    return int(process.env.SESSION_MAX_AGE_MS, 24 * 60 * 60 * 1000);
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
  /**
   * First teacher account for an empty production database. Development keeps
   * using the demo seed instead, so this is opt-in there.
   */
  get bootstrap() {
    return {
      enabled: bool(process.env.BOOTSTRAP_TEACHER, this.isProd),
      username: process.env.BOOTSTRAP_TEACHER_USER || process.env.SEED_TEACHER_USER || 'teacher',
      password: process.env.BOOTSTRAP_TEACHER_PASS || process.env.SEED_TEACHER_PASS || '',
      displayName: process.env.BOOTSTRAP_TEACHER_NAME || 'مدیر',
      allowWeakPassword: bool(process.env.BOOTSTRAP_ALLOW_WEAK, false),
    };
  },
  /**
   * Off-site snapshots of the SQLite file pushed to a GitHub repository. This is
   * the only durability layer on a PaaS whose container filesystem is recreated
   * on redeploy, so it is disabled by default and configured entirely by env.
   */
  get githubBackup() {
    return {
      enabled: bool(process.env.BACKUP_GITHUB_ENABLED, false),
      token: process.env.BACKUP_GITHUB_TOKEN || '',
      repo: (process.env.BACKUP_GITHUB_REPO || '').trim(),
      branch: process.env.BACKUP_GITHUB_BRANCH || 'main',
      dir: (process.env.BACKUP_GITHUB_DIR || 'db-backups').replace(/^\/+|\/+$/g, ''),
      filePrefix: process.env.BACKUP_GITHUB_FILE_PREFIX || 'league',
      intervalMinutes: Math.max(5, int(process.env.BACKUP_GITHUB_INTERVAL_MINUTES, 1440)),
      keep: Math.max(0, int(process.env.BACKUP_GITHUB_KEEP, 7)),
      startDelayMs: Math.max(0, int(process.env.BACKUP_GITHUB_START_DELAY_MS, 60000)),
      maxBytes: Math.max(1, int(process.env.BACKUP_GITHUB_MAX_MB, 50)) * 1024 * 1024,
      restoreOnEmpty: bool(process.env.RESTORE_FROM_GITHUB_ON_EMPTY_LOCAL, true),
      allowPublicRepo: bool(process.env.BACKUP_GITHUB_ALLOW_PUBLIC, false),
      apiBaseUrl: process.env.BACKUP_GITHUB_API_URL || 'https://api.github.com',
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
  /** Public origin used to build payment callbacks and redirects. */
  get appBaseUrl() {
    return (process.env.APP_BASE_URL || `http://localhost:${this.port}`).replace(/\/+$/, '');
  },
  /** Days of free access given to every self-registered teacher. */
  get trialDays() {
    return Math.max(1, Math.min(365, int(process.env.TRIAL_DAYS, 14)));
  },
  /**
   * Site-owner account. It lives in its own table because `users.role` only
   * allows teacher/student. Development gets a known default so the panel is
   * usable immediately; production requires ADMIN_PASSWORD before an account is
   * created.
   */
  get admin() {
    return {
      enabled: bool(process.env.ADMIN_ENABLED, true),
      username: (process.env.ADMIN_USERNAME || 'admin').trim(),
      password: process.env.ADMIN_PASSWORD || (this.isProd ? '' : 'admin1234'),
      displayName: (process.env.ADMIN_NAME || 'مدیر سامانه').trim(),
    };
  },
  /**
   * Payment gateway. Zarinpal is the production default because its v4
   * request/verify API needs no SDK. `mock` renders a local checkout page so the
   * entire subscription flow can be exercised before a merchant ID exists.
   */
  get payments() {
    const provider = String(process.env.PAYMENT_PROVIDER || (this.isProd ? 'zarinpal' : 'mock')).toLowerCase();
    const sandbox = bool(process.env.ZARINPAL_SANDBOX, false);
    return {
      provider: provider === 'zarinpal' ? 'zarinpal' : 'mock',
      zarinpal: {
        merchantId: (process.env.ZARINPAL_MERCHANT_ID || '').trim(),
        sandbox,
        baseUrl: (process.env.ZARINPAL_BASE_URL || (sandbox ? 'https://sandbox.zarinpal.com' : 'https://payment.zarinpal.com')).replace(/\/+$/, ''),
        timeoutMs: Math.max(1000, int(process.env.ZARINPAL_TIMEOUT_MS, 15000)),
      },
    };
  },
  /**
   * sms.ir REST API credentials (https://sms.ir/rest-api/). When the key or the
   * line number is missing, daily reports are still stored in the outbox but
   * are not handed to the provider.
   */
  get sms() {
    const apiKey = (process.env.SMSIR_API_KEY || '').trim();
    const lineNumber = (process.env.SMSIR_LINE_NUMBER || '').trim();
    return {
      apiKey,
      lineNumber,
      baseUrl: (process.env.SMSIR_BASE_URL || 'https://api.sms.ir').replace(/\/+$/, ''),
      enabled: bool(process.env.SMS_ENABLED, Boolean(apiKey && lineNumber)),
      timeoutMs: Math.max(1000, int(process.env.SMS_TIMEOUT_MS, 15000)),
    };
  },
  /**
   * Groq credentials for the Q&A assistant (https://groq.com). A teacher can
   * save a personal key in their own panel; `GROQ_API_KEY` is the shared
   * default used only when that teacher has not saved one.
   */
  get groq() {
    return {
      apiKey: (process.env.GROQ_API_KEY || '').trim(),
      baseUrl: (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
      model: (process.env.GROQ_MODEL || '').trim() || 'openai/gpt-oss-20b',
      timeoutMs: Math.max(1000, int(process.env.GROQ_TIMEOUT_MS, 45000)),
      maxCompletionTokens: Math.max(512, int(process.env.GROQ_MAX_COMPLETION_TOKENS, 4096)),
    };
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
