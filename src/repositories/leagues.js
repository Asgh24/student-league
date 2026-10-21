import { badRequest, notFound } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';
import { compareNames } from '../lib/normalize.js';

export const DEFAULT_COLUMNS = ['ریاضی', 'فارسی', 'علوم', 'مطالعات', 'هدیه', 'هنری', 'پرورشی', 'انضباطی'];
export const DISCIPLINE_COLUMN = 'انضباطی';

export const SETTINGS_DEFAULTS = {
  individualAffectsTeam: false,
  latePenalty: 0,
  absentPenalty: 0,
  grade: '',
  // Mapping of an evaluation mark to league points (see the evaluations page).
  evalPointsEnabled: true,
  evalPointsExcellent: 100,
  evalPointsGood: 25,
  evalPointsFair: -25,
  evalPointsNeedsWork: -50,
  // Size of the classroom seating grid (see the seating page).
  seatingRows: 4,
  seatingCols: 6,
};

/** Point values are whole numbers; the guard keeps accidental typos bounded. */
export const MAX_EVALUATION_POINTS = 100000;

function encodePoints(value) {
  const number = Number.parseInt(value, 10);
  const safe = Number.isFinite(number) ? number : 0;
  return String(Math.max(-MAX_EVALUATION_POINTS, Math.min(MAX_EVALUATION_POINTS, safe)));
}

/** Rows and columns of the seating grid stay between 1 and 20. */
function encodeGridSize(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return '1';
  return String(Math.max(1, Math.min(20, number)));
}

const SETTING_KEYS = {
  individualAffectsTeam: (v) => (v ? '1' : '0'),
  latePenalty: (v) => String(Number.parseInt(v, 10) || 0),
  absentPenalty: (v) => String(Number.parseInt(v, 10) || 0),
  grade: (v) => String(v ?? '').trim().slice(0, 40),
  evalPointsEnabled: (v) => (v ? '1' : '0'),
  evalPointsExcellent: encodePoints,
  evalPointsGood: encodePoints,
  evalPointsFair: encodePoints,
  evalPointsNeedsWork: encodePoints,
  seatingRows: encodeGridSize,
  seatingCols: encodeGridSize,
};

export function readSettings(db, leagueId) {
  const rows = db.prepare('SELECT key, value FROM league_settings WHERE league_id = ?').all(leagueId);
  const settings = { ...SETTINGS_DEFAULTS };
  for (const row of rows) {
    if (row.key === 'individualAffectsTeam') settings.individualAffectsTeam = row.value === '1';
    else if (row.key === 'latePenalty' || row.key === 'absentPenalty') {
      settings[row.key] = Number.parseInt(row.value, 10) || 0;
    } else if (row.key === 'grade') {
      settings.grade = row.value;
    } else if (row.key === 'seatingRows' || row.key === 'seatingCols') {
      settings[row.key] = Number.parseInt(row.value, 10) || SETTINGS_DEFAULTS[row.key];
    } else if (row.key === 'evalPointsEnabled') {
      settings.evalPointsEnabled = row.value === '1';
    } else if (row.key.startsWith('evalPoints')) {
      settings[row.key] = Number.parseInt(row.value, 10) || 0;
    }
  }
  return settings;
}

export function writeSettings(db, leagueId, patch) {
  const upsert = db.prepare(`
    INSERT INTO league_settings (league_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT (league_id, key) DO UPDATE SET value = excluded.value
  `);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const encode = SETTING_KEYS[key];
    if (!encode) throw badRequest('UNKNOWN_SETTING', `تنظیم ناشناخته: ${key}`);
    upsert.run(leagueId, key, encode(value));
  }
  return readSettings(db, leagueId);
}

/** Creates a league together with its default score columns and settings. */
export function createLeague(db, teacherId, name, columns = DEFAULT_COLUMNS) {
  const now = isoNow();
  const run = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO leagues (teacher_id, name, status, created_at) VALUES (?, ?, \'active\', ?)')
      .run(teacherId, String(name).trim(), now);
    const leagueId = Number(info.lastInsertRowid);
    const insertColumn = db.prepare('INSERT INTO columns (league_id, name, step, position, is_default, created_at) VALUES (?, ?, ?, ?, 1, ?)');
    columns.forEach((columnName, index) => insertColumn.run(leagueId, columnName, 25, index, now));
    writeSettings(db, leagueId, SETTINGS_DEFAULTS);
    return leagueId;
  });
  const leagueId = run();
  return getLeague(db, leagueId);
}

export function getLeague(db, leagueId) {
  return db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId) ?? null;
}

export function requireLeague(db, leagueId) {
  const league = getLeague(db, leagueId);
  if (!league) throw notFound('لیگ یافت نشد');
  return league;
}

export function listLeagues(db, teacherId) {
  return db.prepare(`
    SELECT l.*,
           (SELECT COUNT(*) FROM students s WHERE s.league_id = l.id) AS student_count,
           (SELECT COUNT(*) FROM teams t WHERE t.league_id = l.id) AS team_count
    FROM leagues l
    WHERE l.teacher_id = ?
    ORDER BY CASE l.status WHEN 'active' THEN 0 ELSE 1 END, l.id DESC
  `).all(teacherId);
}

export function renameLeague(db, leagueId, name) {
  db.prepare('UPDATE leagues SET name = ? WHERE id = ?').run(String(name).trim(), leagueId);
  return getLeague(db, leagueId);
}

export function deleteLeague(db, leagueId) {
  db.prepare('DELETE FROM leagues WHERE id = ?').run(leagueId);
}

export function getColumns(db, leagueId) {
  return db.prepare('SELECT * FROM columns WHERE league_id = ? ORDER BY position ASC, id ASC').all(leagueId);
}

export function findDisciplineColumn(db, leagueId) {
  const byName = db.prepare('SELECT * FROM columns WHERE league_id = ? AND name = ? ORDER BY position ASC LIMIT 1').get(leagueId, DISCIPLINE_COLUMN);
  if (byName) return byName;
  return db.prepare('SELECT * FROM columns WHERE league_id = ? ORDER BY position ASC LIMIT 1').get(leagueId) ?? null;
}

export function getStudents(db, leagueId) {
  return db.prepare('SELECT * FROM students WHERE league_id = ? ORDER BY id ASC').all(leagueId);
}

/** Final ranking snapshot + medals handed out when a league is completed. */
export function completeLeague(db, leagueId, ranking) {
  const now = isoNow();
  const run = db.transaction(() => {
    db.prepare('UPDATE leagues SET status = \'completed\', completed_at = ?, final_ranking = ? WHERE id = ?')
      .run(now, JSON.stringify(ranking.slice(0, 10)), leagueId);
    const titles = ['قهرمان لیگ', 'نایب قهرمان', 'مقام سوم'];
    const insert = db.prepare('INSERT INTO championships (league_id, student_id, title, rank, source, created_at) VALUES (?, ?, ?, ?, \'league_completed\', ?)');
    ranking.slice(0, 3).forEach((entry, index) => {
      if (entry.total <= 0 && index > 0) return;
      insert.run(leagueId, entry.studentId, titles[index], index + 1, now);
    });
  });
  run();
  return getLeague(db, leagueId);
}

export function reactivateLeague(db, leagueId) {
  db.prepare('UPDATE leagues SET status = \'active\', completed_at = NULL WHERE id = ?').run(leagueId);
  return getLeague(db, leagueId);
}

export function sortByName(rows) {
  return [...rows].sort((a, b) => compareNames(a.name, b.name));
}
