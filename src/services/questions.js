/** Shared helpers for multiple-choice class questions. */

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;

/** Reads a stored JSON option list without ever throwing on bad old data. */
export function parseStoredOptions(value) {
  if (value === null || value === undefined || value === '') return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((option) => typeof option === 'string')
      .map((option) => option.trim())
      .filter(Boolean)
      .slice(0, MAX_OPTIONS);
  } catch {
    return [];
  }
}

/**
 * Builds the public question shape. `optionsJson` is never returned; the
 * correct index is only included for teacher-facing payloads.
 */
export function serializeQuestion(row, { includeCorrectIndex = false } = {}) {
  // Some callers pass an already aliased row, `ownedRow` passes the raw SQLite
  // columns. Supporting both keeps teacher answer review and list endpoints in
  // sync without duplicating the shape in every route.
  const options = parseStoredOptions(row.optionsJson ?? row.options_json);
  const rawCorrectIndex = Number(row.correctIndex ?? row.correct_index);
  const correctIndex = Number.isInteger(rawCorrectIndex) && rawCorrectIndex >= 0 && rawCorrectIndex < options.length
    ? rawCorrectIndex
    : null;
  const question = {
    id: row.id,
    body: row.body,
    points: row.points,
    options,
    type: options.length >= MIN_OPTIONS ? 'multiple_choice' : 'text',
    isOpen: row.isOpen ?? row.is_open,
    createdAt: row.createdAt ?? row.created_at,
  };
  if (row.answerCount !== undefined && row.answerCount !== null) question.answerCount = row.answerCount;
  if (includeCorrectIndex) question.correctIndex = correctIndex;
  return question;
}
