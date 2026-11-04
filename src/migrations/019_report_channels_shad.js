export const id = '019_report_channels_shad';

/**
 * Delivery channels for the daily parent report plus the per-parent Shad link.
 *
 *  - `users.report_*_enabled` are teacher-wide switches: the teacher can turn
 *    SMS or Shad off for every league in one place.
 *  - `students.shad_pv_url` is the private Shad (PV) link of that student's
 *    parent. The teacher opens it in a new tab and pastes the copied report
 *    manually, so no Shad API access is required.
 */
export function up(db) {
  db.exec(`
    ALTER TABLE users ADD COLUMN report_sms_enabled INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE users ADD COLUMN report_shad_enabled INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE students ADD COLUMN shad_pv_url TEXT NOT NULL DEFAULT '';
  `);
}
