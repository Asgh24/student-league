export const id = '011_teacher_groq_settings';

/**
 * Per-teacher Groq API key used by the Q&A AI assistant.
 *
 * The key is encrypted by `src/lib/secrets.js` and never returned to the
 * browser. An empty value means "use the server-wide GROQ_API_KEY fallback".
 */
export function up(db) {
  db.exec(`
    ALTER TABLE users ADD COLUMN groq_api_key TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN groq_updated_at TEXT;
  `);
}
