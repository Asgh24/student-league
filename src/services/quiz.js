/** Presentation-mode quizzes: one student, a random set of class questions. */

import { badRequest, notFound } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';
import { findDisciplineColumn } from '../repositories/leagues.js';
import { applyScoreDelta } from './scoring.js';

function percentOf(correct, total) {
  if (!total) return 0;
  return Math.round((correct / total) * 100);
}

/** Turns a stored row into the payload the teacher page consumes. */
function serialize(row) {
  let items = [];
  try {
    items = JSON.parse(row.itemsJson ?? '[]');
  } catch {
    items = [];
  }
  return {
    id: row.id,
    studentId: row.studentId,
    studentName: row.studentName,
    total: row.totalQuestions,
    correct: row.correctCount,
    percent: percentOf(row.correctCount, row.totalQuestions),
    awardedPoints: row.awardedPoints,
    createdAt: row.createdAt,
    items,
  };
}

const SESSION_COLUMNS = `
  id, student_id AS studentId, student_name AS studentName,
  total_questions AS totalQuestions, correct_count AS correctCount,
  awarded_points AS awardedPoints, items_json AS itemsJson, created_at AS createdAt
`;

export function recentQuizSessions(db, leagueId, limit = 10) {
  return db.prepare(`
    SELECT ${SESSION_COLUMNS} FROM quiz_sessions
    WHERE league_id = ? ORDER BY id DESC LIMIT ?
  `).all(leagueId, Math.max(1, Math.min(50, limit))).map(serialize);
}

/**
 * Records one presentation run and awards the configured points of every
 * correctly answered question to the student. The points come from the stored
 * questions, never from the request body, and the whole run is atomic.
 */
export function createQuizSession(db, leagueId, actor, input) {
  const student = db.prepare('SELECT * FROM students WHERE id = ? AND league_id = ?')
    .get(input.studentId, leagueId);
  if (!student) throw notFound('دانش‌آموز یافت نشد');

  const ids = input.items.map((item) => item.questionId);
  if (new Set(ids).size !== ids.length) {
    throw badRequest('DUPLICATE_QUESTION', 'هر سؤال فقط یک بار در آزمون می‌تواند بیاید');
  }

  const questions = new Map(
    db.prepare('SELECT id, body, points FROM questions WHERE league_id = ?')
      .all(leagueId)
      .map((question) => [question.id, question]),
  );

  const items = [];
  let correctCount = 0;
  let requestedPoints = 0;
  for (const entry of input.items) {
    const question = questions.get(entry.questionId);
    if (!question) throw badRequest('QUESTION_NOT_FOUND', 'سؤال انتخاب‌شده در این لیگ نیست');
    const correct = entry.correct === true;
    const points = Math.max(0, Number(question.points) || 0);
    if (correct) {
      correctCount += 1;
      requestedPoints += points;
    }
    items.push({
      questionId: question.id,
      body: question.body,
      points,
      correct,
      awarded: correct ? points : 0,
    });
  }

  const run = db.transaction(() => {
    let appliedPoints = 0;
    if (requestedPoints > 0) {
      const column = findDisciplineColumn(db, leagueId);
      if (column) {
        applyScoreDelta(db, {
          leagueId,
          student,
          column,
          delta: requestedPoints,
          reason: `آزمون سوال و پاسخ (${correctCount} از ${items.length})`,
          actor,
        });
        appliedPoints = requestedPoints;
      }
    }
    const info = db.prepare(`
      INSERT INTO quiz_sessions
        (league_id, teacher_id, student_id, student_name, total_questions,
         correct_count, awarded_points, items_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      leagueId,
      actor?.id ?? null,
      student.id,
      student.name,
      items.length,
      correctCount,
      appliedPoints,
      JSON.stringify(items),
      isoNow(),
    );
    return Number(info.lastInsertRowid);
  });

  const id = run();
  const session = serialize(db.prepare(`SELECT ${SESSION_COLUMNS} FROM quiz_sessions WHERE id = ?`).get(id));
  return { session, requestedPoints, pointsApplied: session.awardedPoints > 0 || requestedPoints === 0 };
}
