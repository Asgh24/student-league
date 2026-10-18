export const id = '001_core';

/**
 * Core domain: accounts, sessions, leagues, students, score columns, scores,
 * append-only score history, teams, championships, attendance, settings, timers.
 */
export function up(db) {
  db.exec(`
    CREATE TABLE users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
      display_name  TEXT NOT NULL,
      persian_digits INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE sessions (
      sid        TEXT PRIMARY KEY,
      expires    INTEGER NOT NULL,
      data       TEXT NOT NULL
    );
    CREATE INDEX idx_sessions_expires ON sessions (expires);

    CREATE TABLE leagues (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
      created_at   TEXT NOT NULL,
      completed_at TEXT,
      final_ranking TEXT
    );
    CREATE INDEX idx_leagues_teacher ON leagues (teacher_id, status);

    CREATE TABLE league_settings (
      league_id INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      key       TEXT NOT NULL,
      value     TEXT NOT NULL,
      PRIMARY KEY (league_id, key)
    );

    CREATE TABLE students (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id  INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      user_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_students_league ON students (league_id);
    CREATE INDEX idx_students_user ON students (user_id);

    CREATE TABLE columns (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id  INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      step       INTEGER NOT NULL DEFAULT 25,
      position   INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_columns_league ON columns (league_id, position);

    CREATE TABLE scores (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id  INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      column_id  INTEGER NOT NULL REFERENCES columns (id) ON DELETE CASCADE,
      value      INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE (student_id, column_id)
    );
    CREATE INDEX idx_scores_league ON scores (league_id);
    CREATE INDEX idx_scores_student ON scores (student_id);
    CREATE INDEX idx_scores_column ON scores (column_id);

    CREATE TABLE score_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id   INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      student_id  INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      column_id   INTEGER REFERENCES columns (id) ON DELETE SET NULL,
      column_name TEXT NOT NULL DEFAULT '',
      delta       INTEGER NOT NULL,
      reason      TEXT NOT NULL DEFAULT '',
      actor_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
      actor_name  TEXT NOT NULL DEFAULT '',
      total_after INTEGER NOT NULL,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX idx_history_student ON score_history (student_id, created_at);
    CREATE INDEX idx_history_league ON score_history (league_id, created_at);

    CREATE TABLE teams (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id  INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      points     INTEGER NOT NULL DEFAULT 0,
      label      TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (league_id, name)
    );
    CREATE INDEX idx_teams_league ON teams (league_id);

    CREATE TABLE team_members (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id    INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL UNIQUE REFERENCES students (id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_team_members_team ON team_members (team_id);

    CREATE TABLE team_points_adjustments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id    INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
      delta      INTEGER NOT NULL,
      reason     TEXT NOT NULL DEFAULT '',
      actor_id   INTEGER REFERENCES users (id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_team_adjust_team ON team_points_adjustments (team_id);

    CREATE TABLE championships (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id  INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      title      TEXT NOT NULL DEFAULT 'قهرمانی',
      rank       INTEGER NOT NULL DEFAULT 1,
      source     TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_championships_student ON championships (student_id, created_at);
    CREATE INDEX idx_championships_league ON championships (league_id);

    CREATE TABLE attendance (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id  INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      day        TEXT NOT NULL,
      status     TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (student_id, day)
    );
    CREATE INDEX idx_attendance_league_day ON attendance (league_id, day);
    CREATE INDEX idx_attendance_student ON attendance (student_id, day);

    CREATE TABLE timers (
      league_id        INTEGER PRIMARY KEY REFERENCES leagues (id) ON DELETE CASCADE,
      ends_at          TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );

    CREATE TABLE raffle_history (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id    INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      student_id   INTEGER REFERENCES students (id) ON DELETE SET NULL,
      student_name TEXT NOT NULL,
      reason       TEXT NOT NULL DEFAULT '',
      actor_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX idx_raffle_league ON raffle_history (league_id, created_at);

    CREATE TABLE likes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id       INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      from_student_id INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      to_student_id   INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      achievement     TEXT NOT NULL DEFAULT '',
      day             TEXT NOT NULL,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX idx_likes_from ON likes (from_student_id, day);
    CREATE INDEX idx_likes_to ON likes (to_student_id);
  `);
}
