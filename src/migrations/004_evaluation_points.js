export const id = '004_evaluation_points';

/**
 * Evaluation marks can be converted into league points (see the
 * «تنظیمات امتیازدهی» panel). The applied value is stored next to the mark so a
 * re-save, a settings change or an evaluation edit only adjusts the difference
 * instead of adding the same points twice.
 *
 * `awarded_column_id` remembers which column received the points, so editing the
 * subject (which can relink the evaluation to another column) can move them.
 */
export function up(db) {
  db.exec(`
    ALTER TABLE evaluation_scores ADD COLUMN awarded_points INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE evaluation_scores ADD COLUMN awarded_column_id INTEGER REFERENCES columns (id) ON DELETE SET NULL;
  `);
}
