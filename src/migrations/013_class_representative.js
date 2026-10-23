export const id = '013_class_representative';

/**
 * «نماینده کلاس»: fair, non-repeating representative draws.
 *
 * A cycle holds one pick per student. History is kept across cycles so the
 * teacher can see who has already had a turn, while a fresh cycle starts with
 * an empty pool. `student_name` is denormalized on purpose: deleting a student
 * must not erase the class history.
 */
export function up(db) {
  db.exec(`
    CREATE TABLE representative_cycles (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id    INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      cycle        INTEGER NOT NULL,
      started_at   TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE (league_id, cycle)
    );
    CREATE INDEX idx_representative_cycles_league ON representative_cycles (league_id, cycle);

    CREATE TABLE representative_history (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id    INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      student_id   INTEGER REFERENCES students (id) ON DELETE SET NULL,
      student_name TEXT NOT NULL,
      cycle        INTEGER NOT NULL,
      actor_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
      created_at   TEXT NOT NULL,
      UNIQUE (league_id, cycle, student_id)
    );
    CREATE INDEX idx_representative_history_league ON representative_history (league_id, cycle, created_at);
  `);
}
