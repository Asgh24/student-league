export const id = '002_tools';

/** Classroom tools: homework, Q&A, weekly schedule, shared files, wheel segments. */
export function up(db) {
  db.exec(`
    CREATE TABLE homework (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id   INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      teacher_id  INTEGER REFERENCES users (id) ON DELETE SET NULL,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      due_date    TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX idx_homework_league ON homework (league_id, created_at);

    CREATE TABLE homework_status (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      homework_id INTEGER NOT NULL REFERENCES homework (id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      status     TEXT NOT NULL DEFAULT 'not_done' CHECK (status IN ('done', 'not_done')),
      updated_at TEXT NOT NULL,
      UNIQUE (homework_id, student_id)
    );
    CREATE INDEX idx_homework_status_homework ON homework_status (homework_id);
    CREATE INDEX idx_homework_status_student ON homework_status (student_id);

    CREATE TABLE questions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id  INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      teacher_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
      body       TEXT NOT NULL,
      points     INTEGER NOT NULL DEFAULT 0,
      is_open    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_questions_league ON questions (league_id, created_at);

    CREATE TABLE answers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
      student_id  INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      body        TEXT NOT NULL,
      awarded     INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      UNIQUE (question_id, student_id)
    );
    CREATE INDEX idx_answers_question ON answers (question_id);
    CREATE INDEX idx_answers_student ON answers (student_id);

    CREATE TABLE schedule (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id  INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      day_index  INTEGER NOT NULL CHECK (day_index BETWEEN 0 AND 6),
      period     INTEGER NOT NULL CHECK (period BETWEEN 0 AND 20),
      subject    TEXT NOT NULL DEFAULT '',
      note       TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      UNIQUE (league_id, day_index, period)
    );
    CREATE INDEX idx_schedule_league ON schedule (league_id, day_index, period);

    CREATE TABLE files (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id     INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      teacher_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
      original_name TEXT NOT NULL,
      stored_name   TEXT NOT NULL UNIQUE,
      mime          TEXT NOT NULL DEFAULT 'application/octet-stream',
      size          INTEGER NOT NULL DEFAULT 0,
      description   TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL
    );
    CREATE INDEX idx_files_league ON files (league_id, created_at);

    CREATE TABLE wheel_segments (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      label     TEXT NOT NULL,
      position  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_wheel_league ON wheel_segments (league_id, position);
  `);
}
