export const id = '021_support_messages';

/**
 * Support tickets: site users (teachers and students) message the site
 * management, and an admin answers from the admin dashboard.
 *
 * This deliberately mirrors the teacher <-> student messaging tables
 * (`conversations` / `messages`) but lives in its own tables: an admin is not
 * a `users` row, so `messages.sender_user_id` cannot represent an admin reply,
 * and the class conversations must stay untouched.
 *
 *  - `support_threads.user_id` is the site user who opened the ticket.
 *  - `support_messages.sender_role` is 'user' or 'admin'; exactly one of
 *    `sender_user_id` / `sender_admin_id` is set per message.
 *  - `status` moves open -> answered (admin replied) -> closed (admin closed).
 */
export function up(db) {
  db.exec(`
    CREATE TABLE support_threads (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id              INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      subject              TEXT NOT NULL DEFAULT '',
      status               TEXT NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open', 'answered', 'closed')),
      last_message_at      TEXT,
      last_message_preview TEXT NOT NULL DEFAULT '',
      created_at           TEXT NOT NULL
    );
    CREATE INDEX idx_support_threads_user ON support_threads (user_id, last_message_at);
    CREATE INDEX idx_support_threads_status ON support_threads (status, last_message_at);

    CREATE TABLE support_messages (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id        INTEGER NOT NULL REFERENCES support_threads (id) ON DELETE CASCADE,
      sender_role      TEXT NOT NULL CHECK (sender_role IN ('user', 'admin')),
      sender_user_id   INTEGER REFERENCES users (id) ON DELETE SET NULL,
      sender_admin_id  INTEGER REFERENCES admins (id) ON DELETE SET NULL,
      body             TEXT NOT NULL,
      created_at       TEXT NOT NULL,
      read_at          TEXT,
      CHECK (sender_role = 'user' OR sender_admin_id IS NOT NULL),
      CHECK (sender_role = 'admin' OR sender_user_id IS NOT NULL)
    );
    CREATE INDEX idx_support_messages_thread ON support_messages (thread_id, id);
    CREATE INDEX idx_support_messages_unread ON support_messages (thread_id, read_at);
  `);
}
