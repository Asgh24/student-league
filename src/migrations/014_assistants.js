export const id = '014_assistants';

/**
 * «همیار سایت دانش‌آموزی»: a student receives a separate teacher-like login
 * scoped to one league with an explicit set of section permissions.
 *
 * The assistant is a normal `users` row with role `teacher` plus a row here.
 * `is_assistant` keeps these accounts out of admin teacher lists and lets the
 * auth middleware reject a user whose assistant row was removed.
 *
 * The audit log is intentionally tiny: only successful mutations are stored,
 * names are denormalized so deleting an assistant keeps history readable, and
 * rows older than seven days are purged on write/read.
 */
export function up(db) {
  db.exec(`
    ALTER TABLE users ADD COLUMN is_assistant INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE assistant_accounts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
      owner_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      league_id   INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      student_id  INTEGER REFERENCES students (id) ON DELETE SET NULL,
      permissions TEXT NOT NULL DEFAULT '[]',
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX idx_assistant_accounts_owner ON assistant_accounts (owner_id, league_id);
    CREATE INDEX idx_assistant_accounts_league ON assistant_accounts (league_id);
    CREATE UNIQUE INDEX idx_assistant_accounts_student
      ON assistant_accounts (student_id)
      WHERE student_id IS NOT NULL AND active = 1;

    CREATE TABLE assistant_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      league_id      INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      assistant_id   INTEGER REFERENCES assistant_accounts (id) ON DELETE SET NULL,
      assistant_name TEXT NOT NULL DEFAULT '',
      action         TEXT NOT NULL DEFAULT '',
      detail         TEXT NOT NULL DEFAULT '',
      created_at     TEXT NOT NULL
    );
    CREATE INDEX idx_assistant_log_owner_time ON assistant_log (owner_id, created_at);
    CREATE INDEX idx_assistant_log_league_time ON assistant_log (league_id, created_at);
  `);
}
