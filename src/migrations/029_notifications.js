export const id = '029_notifications';

/**
 * In-site notification centre.
 *
 * A notification is written once (`notifications`) and materialised per
 * recipient (`notification_recipients`). Fan-out keeps the inbox query trivial
 * (index by user), makes "read" state per person and lets a small site answer
 * the unread badge with a single COUNT. Sent notifications keep the audience
 * label, the sender name, an optional internal link and the SMS delivery counts
 * so the history page never needs to replay the send.
 */
export function up(db) {
  db.exec(`
    CREATE TABLE notifications (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source          TEXT NOT NULL CHECK (source IN ('teacher', 'admin')),
      sender_id       INTEGER NOT NULL,
      sender_name     TEXT NOT NULL,
      audience        TEXT NOT NULL CHECK (audience IN ('all', 'teachers', 'students', 'league', 'selected', 'student')),
      league_id       INTEGER REFERENCES leagues (id) ON DELETE CASCADE,
      student_id      INTEGER REFERENCES students (id) ON DELETE SET NULL,
      title           TEXT NOT NULL,
      body            TEXT NOT NULL,
      category        TEXT NOT NULL DEFAULT 'info' CHECK (category IN ('info', 'success', 'warning', 'urgent')),
      link            TEXT NOT NULL DEFAULT '',
      pinned          INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
      sms_json        TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL
    );

    CREATE INDEX idx_notifications_source ON notifications (source, id DESC);
    CREATE INDEX idx_notifications_league ON notifications (league_id, id DESC);

    CREATE TABLE notification_recipients (
      notification_id INTEGER NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      read_at         TEXT,
      created_at      TEXT NOT NULL,
      PRIMARY KEY (notification_id, user_id)
    );

    CREATE INDEX idx_notification_recipients_user
      ON notification_recipients (user_id, read_at);
  `);
}
