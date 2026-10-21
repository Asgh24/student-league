/** «جای‌گیری» — the classroom seating plan of a league. */

import { badRequest } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';
import { getStudents, readSettings, writeSettings } from '../repositories/leagues.js';

export const MAX_ROWS = 20;
export const MAX_COLS = 20;

/** Fisher–Yates; keeps the random order unbiased. */
function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function clamp(value, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

/** The current plan: grid size, seated students and the students without a seat. */
export function seatingPlan(db, leagueId) {
  const settings = readSettings(db, leagueId);
  const rows = clamp(settings.seatingRows, 1, MAX_ROWS);
  const cols = clamp(settings.seatingCols, 1, MAX_COLS);
  const students = getStudents(db, leagueId);
  const seats = db.prepare(`
    SELECT ss.row_index AS row, ss.col_index AS col, s.id AS studentId, s.name AS name
    FROM seating_seats ss JOIN students s ON s.id = ss.student_id
    WHERE ss.league_id = ? ORDER BY ss.row_index ASC, ss.col_index ASC
  `).all(leagueId);
  const seated = new Set(seats.map((seat) => seat.studentId));
  return {
    layout: { rows, cols },
    seats,
    students: students.map((student) => ({ id: student.id, name: student.name })),
    unassigned: students.filter((student) => !seated.has(student.id)).map((student) => ({ id: student.id, name: student.name })),
  };
}

/** Replaces the whole plan; every seat is validated before anything is written. */
export function saveSeatingPlan(db, leagueId, input) {
  const rows = clamp(input.rows, 1, MAX_ROWS);
  const cols = clamp(input.cols, 1, MAX_COLS);
  const seats = Array.isArray(input.seats) ? input.seats : [];
  const students = new Map(getStudents(db, leagueId).map((student) => [student.id, student]));
  const positions = new Set();
  const seated = new Set();

  for (const seat of seats) {
    const row = Number.parseInt(seat.row, 10);
    const col = Number.parseInt(seat.col, 10);
    const studentId = Number.parseInt(seat.studentId, 10);
    if (!Number.isFinite(row) || !Number.isFinite(col) || row < 0 || row >= rows || col < 0 || col >= cols) {
      throw badRequest('SEAT_OUT_OF_RANGE', 'جای دانش‌آموز خارج از چیدمان کلاس است');
    }
    const position = `${row}:${col}`;
    if (positions.has(position)) throw badRequest('DUPLICATE_SEAT', 'دو دانش‌آموز نمی‌توانند روی یک صندلی بنشینند');
    positions.add(position);
    if (!students.has(studentId)) throw badRequest('UNKNOWN_STUDENT', 'دانش‌آموز در این لیگ نیست');
    if (seated.has(studentId)) throw badRequest('DUPLICATE_STUDENT', 'هر دانش‌آموز فقط یک جا دارد');
    seated.add(studentId);
  }

  const run = db.transaction(() => {
    writeSettings(db, leagueId, { seatingRows: rows, seatingCols: cols });
    db.prepare('DELETE FROM seating_seats WHERE league_id = ?').run(leagueId);
    const insert = db.prepare(`
      INSERT INTO seating_seats (league_id, student_id, row_index, col_index, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const now = isoNow();
    for (const seat of seats) {
      insert.run(leagueId, Number.parseInt(seat.studentId, 10), Number.parseInt(seat.row, 10), Number.parseInt(seat.col, 10), now);
    }
  });
  run();

  return seatingPlan(db, leagueId);
}

/**
 * Seats every student at random. When possible nobody keeps the seat they had
 * before, so a reshuffle really moves the class around.
 */
export function shuffleSeating(db, leagueId) {
  const plan = seatingPlan(db, leagueId);
  const { rows, cols } = plan.layout;
  const capacity = rows * cols;
  const positions = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) positions.push({ row, col });
  }
  const previous = new Map(plan.seats.map((seat) => [seat.studentId, `${seat.row}:${seat.col}`]));
  const count = Math.min(plan.students.length, capacity);

  let students = shuffle(plan.students);
  let chairs = shuffle(positions).slice(0, count);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const unchanged = students.some((student, index) => {
      const chair = chairs[index];
      return previous.get(student.id) === `${chair.row}:${chair.col}`;
    });
    if (!unchanged) break;
    students = shuffle(plan.students);
    chairs = shuffle(positions).slice(0, count);
  }

  const seats = students.slice(0, count).map((student, index) => ({
    studentId: student.id,
    row: chairs[index].row,
    col: chairs[index].col,
  }));

  return saveSeatingPlan(db, leagueId, { rows, cols, seats });
}

/** Empties every seat but keeps the grid size. */
export function clearSeating(db, leagueId) {
  const { rows, cols } = seatingPlan(db, leagueId).layout;
  return saveSeatingPlan(db, leagueId, { rows, cols, seats: [] });
}

/** The seat of one student — used by the student portal. */
export function seatForStudent(db, studentId) {
  const row = db.prepare(`
    SELECT row_index AS row, col_index AS col FROM seating_seats WHERE student_id = ?
  `).get(studentId);
  if (!row) return null;
  return { row: row.row, col: row.col, label: `ردیف ${row.row + 1}، صندلی ${row.col + 1}` };
}
