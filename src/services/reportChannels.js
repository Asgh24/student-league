/**
 * Teacher-wide delivery channels of the daily parent report.
 *
 * The switches live on the teacher account (not on one league), so turning SMS
 * or Shad off in the report panel applies to every league in that dashboard.
 */

export const REPORT_CHANNELS = ['sms', 'shad'];

const DEFAULTS = { sms: true, shad: true };

export function reportChannels(db, teacherId) {
  if (!db || !teacherId) return { ...DEFAULTS };
  const row = db.prepare(`
    SELECT report_sms_enabled AS sms, report_shad_enabled AS shad
    FROM users WHERE id = ?
  `).get(teacherId);
  if (!row) return { ...DEFAULTS };
  return { sms: row.sms === 1, shad: row.shad === 1 };
}

/** Saves only the channels present in `input`; returns the resulting state. */
export function saveReportChannels(db, teacherId, input = {}) {
  const current = reportChannels(db, teacherId);
  const next = {
    sms: input.sms === undefined ? current.sms : Boolean(input.sms),
    shad: input.shad === undefined ? current.shad : Boolean(input.shad),
  };
  db.prepare('UPDATE users SET report_sms_enabled = ?, report_shad_enabled = ? WHERE id = ?')
    .run(next.sms ? 1 : 0, next.shad ? 1 : 0, teacherId);
  return next;
}
