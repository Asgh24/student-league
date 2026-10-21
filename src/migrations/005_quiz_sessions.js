export const id = '005_quiz_sessions';

/**
 * Presentation-mode «حالت پخش» runs: the teacher shows a random set of class
 * questions to one student and marks each answer correct/wrong. The run is kept
 * as a snapshot (`items_json`) so the result survives edits or deletion of the
 * source questions, and `awarded_points` records what was added to the league.
 */
export function up(db) {
  db.exec(`
    CREATE TABLE quiz_sessions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id       INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      teacher_id      INTEGER REFERENCES users (id) ON DELETE SET NULL,
      student_id      INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      student_name    TEXT NOT NULL,
      total_questions INTEGER NOT NULL,
      correct_count   INTEGER NOT NULL DEFAULT 0,
      awarded_points  INTEGER NOT NULL DEFAULT 0,
      items_json      TEXT NOT NULL DEFAULT '[]',
      created_at      TEXT NOT NULL
    );
    CREATE INDEX idx_quiz_sessions_league ON quiz_sessions (league_id, id DESC);
  `);
}
