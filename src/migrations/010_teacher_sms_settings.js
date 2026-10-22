export const id = '010_teacher_sms_settings';

/**
 * Per-teacher sms.ir credentials.
 *
 * Each teacher can use the API key and sender line of their own sms.ir panel
 * without editing `.env` or sharing credentials with other teachers. The API
 * key is encrypted by `src/lib/secrets.js`; only the public line number and a
 * "key is saved" flag are ever returned to the browser.
 *
 * Both columns stay empty for existing teachers, so the server-wide env
 * fallback continues to work until a teacher configures their own account.
 */
export function up(db) {
  db.exec(`
    ALTER TABLE users ADD COLUMN sms_api_key TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN sms_line_number TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN sms_updated_at TEXT;
  `);
}
