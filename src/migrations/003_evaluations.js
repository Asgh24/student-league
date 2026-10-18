export const id = '003_evaluations';

/**
 * Course evaluation: a teacher records an exam / weekly assessment with either a
 * numeric mark (0-20 by default) or a descriptive level, per student. Marks are
 * kept separate from league points (no automatic transfer).
 */
export function up(db) {
  db.exec(`
    CREATE TABLE evaluations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id  INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      teacher_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
      subject    TEXT NOT NULL,
      title      TEXT NOT NULL,
      level      TEXT NOT NULL DEFAULT '',
      grade      TEXT NOT NULL DEFAULT '',
      kind       TEXT NOT NULL DEFAULT 'numeric' CHECK (kind IN ('numeric', 'descriptive')),
      scale_min  INTEGER NOT NULL DEFAULT 0,
      scale_max  INTEGER NOT NULL DEFAULT 20,
      held_on    TEXT NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      column_id  INTEGER REFERENCES columns (id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_evaluations_league ON evaluations (league_id, held_on DESC);

    CREATE TABLE evaluation_scores (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      evaluation_id INTEGER NOT NULL REFERENCES evaluations (id) ON DELETE CASCADE,
      student_id    INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      score         REAL,
      label         TEXT NOT NULL DEFAULT '',
      note          TEXT NOT NULL DEFAULT '',
      updated_at    TEXT NOT NULL,
      UNIQUE (evaluation_id, student_id)
    );
    CREATE INDEX idx_evaluation_scores_evaluation ON evaluation_scores (evaluation_id);
    CREATE INDEX idx_evaluation_scores_student ON evaluation_scores (student_id);
  `);
}
