export const id = '006_seating';

/**
 * «جای‌گیری» — the classroom seating plan. One row per seated student; the
 * grid size (rows × columns) lives in the league settings, empty seats simply
 * have no row.
 */
export function up(db) {
  db.exec(`
    CREATE TABLE seating_seats (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id  INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      row_index  INTEGER NOT NULL,
      col_index  INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_seating_position ON seating_seats (league_id, row_index, col_index);
    CREATE UNIQUE INDEX idx_seating_student ON seating_seats (league_id, student_id);
  `);
}
