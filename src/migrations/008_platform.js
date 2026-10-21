export const id = '008_platform';

/**
 * Monetization and communication layer:
 * - a separate `admins` table (the legacy `users.role` CHECK only allows
 *   teacher/student, and SQLite cannot change a CHECK in place),
 * - per-teacher trial/subscription dates (NULL + NULL = unlimited, which keeps
 *   the existing teacher account working),
 * - editable subscription plans and payment records,
 * - teacher/student conversations with read receipts,
 * - admin SMS campaigns (league report messages stay in `sms_messages`).
 */
export function up(db) {
  const now = new Date().toISOString();

  db.exec(`
    CREATE TABLE admins (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE subscription_plans (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      days        INTEGER NOT NULL CHECK (days BETWEEN 1 AND 3650),
      price       INTEGER NOT NULL CHECK (price >= 0),
      description TEXT NOT NULL DEFAULT '',
      active      INTEGER NOT NULL DEFAULT 1,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    ALTER TABLE users ADD COLUMN trial_ends_at TEXT;
    ALTER TABLE users ADD COLUMN subscription_ends_at TEXT;
    ALTER TABLE users ADD COLUMN subscription_started_at TEXT;
    ALTER TABLE users ADD COLUMN subscription_plan_id INTEGER REFERENCES subscription_plans (id) ON DELETE SET NULL;
    ALTER TABLE users ADD COLUMN subscription_note TEXT NOT NULL DEFAULT '';

    CREATE TABLE payments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      plan_id     INTEGER REFERENCES subscription_plans (id) ON DELETE SET NULL,
      plan_name   TEXT NOT NULL DEFAULT '',
      amount      INTEGER NOT NULL CHECK (amount >= 0),
      days        INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'canceled')),
      provider    TEXT NOT NULL DEFAULT 'mock',
      authority   TEXT,
      ref_id      TEXT,
      card_pan    TEXT,
      error       TEXT NOT NULL DEFAULT '',
      note        TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      paid_at     TEXT,
      starts_at   TEXT,
      ends_at     TEXT
    );
    CREATE INDEX idx_payments_teacher ON payments (teacher_id, created_at);
    CREATE INDEX idx_payments_status ON payments (status, created_at);
    CREATE UNIQUE INDEX idx_payments_authority ON payments (authority) WHERE authority IS NOT NULL;

    CREATE TABLE conversations (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id           INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      student_id           INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      league_id            INTEGER REFERENCES leagues (id) ON DELETE SET NULL,
      subject              TEXT NOT NULL DEFAULT '',
      last_message_at      TEXT,
      last_message_preview TEXT NOT NULL DEFAULT '',
      created_at           TEXT NOT NULL,
      UNIQUE (teacher_id, student_id)
    );
    CREATE INDEX idx_conversations_teacher ON conversations (teacher_id, last_message_at);
    CREATE INDEX idx_conversations_student ON conversations (student_id, last_message_at);

    CREATE TABLE messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      sender_user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      body            TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      read_at         TEXT
    );
    CREATE INDEX idx_messages_conversation ON messages (conversation_id, id);
    CREATE INDEX idx_messages_unread ON messages (conversation_id, read_at);

    CREATE TABLE sms_campaigns (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id            INTEGER REFERENCES admins (id) ON DELETE SET NULL,
      kind                TEXT NOT NULL DEFAULT 'bulk' CHECK (kind IN ('test', 'bulk')),
      mobile              TEXT NOT NULL,
      body                TEXT NOT NULL,
      status              TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
      provider            TEXT NOT NULL DEFAULT 'sms.ir',
      provider_message_id TEXT,
      error               TEXT NOT NULL DEFAULT '',
      created_at          TEXT NOT NULL,
      sent_at             TEXT
    );
    CREATE INDEX idx_sms_campaigns_created ON sms_campaigns (created_at);
    CREATE INDEX idx_sms_campaigns_status ON sms_campaigns (status, created_at);
  `);

  const insertPlan = db.prepare(`
    INSERT INTO subscription_plans (name, days, price, description, active, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?)
  `);
  insertPlan.run('اشتراک یک‌ماهه', 30, 149000, 'دسترسی کامل به تمام ابزارهای معلم برای ۳۰ روز', 1, now, now);
  insertPlan.run('اشتراک سه‌ماهه', 90, 399000, 'سه ماه دسترسی کامل؛ مناسب یک ترم تحصیلی', 2, now, now);
  insertPlan.run('اشتراک یک‌ساله', 365, 1290000, 'یک سال دسترسی کامل با بیشترین صرفه‌جویی', 3, now, now);
}
