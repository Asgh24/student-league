export const id = '007_contacts_reports';

/**
 * Parent/student mobile numbers and the SMS outbox used by the daily parent
 * report. Messages are stored before they are handed to the provider so a
 * failed or unconfigured SMS provider never loses the report.
 */
export function up(db) {
  db.exec(`
    ALTER TABLE students ADD COLUMN parent_phone TEXT NOT NULL DEFAULT '';
    ALTER TABLE students ADD COLUMN student_phone TEXT NOT NULL DEFAULT '';

    CREATE TABLE sms_messages (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id           INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      student_id          INTEGER REFERENCES students (id) ON DELETE SET NULL,
      mobile              TEXT NOT NULL,
      kind                TEXT NOT NULL DEFAULT 'daily_report',
      report_date         TEXT NOT NULL DEFAULT '',
      body                TEXT NOT NULL,
      status              TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
      provider            TEXT NOT NULL DEFAULT 'sms.ir',
      provider_message_id TEXT,
      error               TEXT NOT NULL DEFAULT '',
      created_at          TEXT NOT NULL,
      sent_at             TEXT
    );
    CREATE INDEX idx_sms_messages_league ON sms_messages (league_id, created_at);
    CREATE INDEX idx_sms_messages_student ON sms_messages (student_id, report_date);
  `);
}
