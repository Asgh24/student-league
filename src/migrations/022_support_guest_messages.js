export const id = '022_support_guest_messages';

/**
 * One-way contact messages from visitors who are not logged in (for example a
 * question asked from the login page). They are shown to the site admin in the
 * support panel together with the contact details the guest left behind.
 *
 * They cannot reuse `support_threads` because that table requires a `users`
 * row, and a guest has no account. A separate table keeps the authenticated
 * ticket flow untouched.
 */
export function up(db) {
  db.exec(`
    CREATE TABLE support_guest_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      contact    TEXT NOT NULL,
      subject    TEXT NOT NULL DEFAULT '',
      body       TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read')),
      created_at TEXT NOT NULL,
      read_at    TEXT
    );
    CREATE INDEX idx_support_guest_status ON support_guest_messages (status, created_at);
  `);
}
