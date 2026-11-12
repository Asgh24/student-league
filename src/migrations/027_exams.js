export const id = '027_exams';

/**
 * Professional exam module on top of the existing class question bank.
 *
 * The old `questions`/`answers` flow stays untouched for backward
 * compatibility. Exams reference bank questions, snapshot every attempt, and
 * grade server-side so the client never receives the correct choice early.
 *
 *  - `exams` stores the teacher-authored settings and publish window.
 *  - `exam_questions` is the ordered question selection.
 *  - `exam_attempts` keeps one row per student run (timer + result).
 *  - `exam_attempt_answers` is a full snapshot of the paper at start time, so
 *    editing/deleting bank questions cannot corrupt a finished attempt.
 */
export function up(db) {
  db.exec(`
    ALTER TABLE questions ADD COLUMN explanation TEXT NOT NULL DEFAULT '';
    ALTER TABLE questions ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'medium';
    ALTER TABLE questions ADD COLUMN subject TEXT NOT NULL DEFAULT '';

    CREATE TABLE exams (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id         INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      teacher_id        INTEGER REFERENCES users (id) ON DELETE SET NULL,
      title             TEXT NOT NULL,
      description       TEXT NOT NULL DEFAULT '',
      subject           TEXT NOT NULL DEFAULT '',
      duration_minutes  INTEGER NOT NULL DEFAULT 20,
      pass_percent      INTEGER NOT NULL DEFAULT 50,
      max_attempts      INTEGER NOT NULL DEFAULT 1,
      shuffle_questions INTEGER NOT NULL DEFAULT 1,
      shuffle_options   INTEGER NOT NULL DEFAULT 1,
      show_answers      INTEGER NOT NULL DEFAULT 1,
      reward_points     INTEGER NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
      opens_at          TEXT,
      closes_at         TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );
    CREATE INDEX idx_exams_league ON exams (league_id, id DESC);

    CREATE TABLE exam_questions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id     INTEGER NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
      position    INTEGER NOT NULL DEFAULT 0,
      points      INTEGER NOT NULL DEFAULT 0,
      UNIQUE (exam_id, question_id)
    );
    CREATE INDEX idx_exam_questions_exam ON exam_questions (exam_id, position);

    CREATE TABLE exam_attempts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id         INTEGER NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
      student_id      INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      attempt_no      INTEGER NOT NULL DEFAULT 1,
      status          TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'expired')),
      started_at      TEXT NOT NULL,
      expires_at      TEXT NOT NULL,
      submitted_at    TEXT,
      total_questions INTEGER NOT NULL DEFAULT 0,
      correct_count   INTEGER NOT NULL DEFAULT 0,
      max_points      INTEGER NOT NULL DEFAULT 0,
      score_points    INTEGER NOT NULL DEFAULT 0,
      percent         INTEGER NOT NULL DEFAULT 0,
      passed          INTEGER NOT NULL DEFAULT 0,
      awarded_points  INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX idx_exam_attempts_exam ON exam_attempts (exam_id, id DESC);
    CREATE INDEX idx_exam_attempts_student ON exam_attempts (student_id, exam_id, id DESC);

    CREATE TABLE exam_attempt_answers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id    INTEGER NOT NULL REFERENCES exam_attempts (id) ON DELETE CASCADE,
      question_id   INTEGER REFERENCES questions (id) ON DELETE SET NULL,
      position      INTEGER NOT NULL DEFAULT 0,
      body          TEXT NOT NULL DEFAULT '',
      options_json  TEXT NOT NULL DEFAULT '[]',
      correct_index INTEGER NOT NULL DEFAULT 0,
      points        INTEGER NOT NULL DEFAULT 0,
      selected_index INTEGER,
      is_correct    INTEGER,
      awarded       INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      UNIQUE (attempt_id, position)
    );
    CREATE INDEX idx_exam_attempt_answers_attempt ON exam_attempt_answers (attempt_id, position);
  `);
}
