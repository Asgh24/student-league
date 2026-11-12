/** Professional exams: teacher authoring, timed attempts and server-side grading. */

import { badRequest, notFound } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';
import { findDisciplineColumn } from '../repositories/leagues.js';
import { MIN_OPTIONS, parseStoredOptions, serializeQuestion } from './questions.js';
import { applyScoreDelta } from './scoring.js';

const nowMs = () => Date.parse(isoNow());

function toBool(value) {
  return value === true || value === 1 || value === '1';
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function percentOf(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function shuffled(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function normalizeDate(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw badRequest('DATE_INVALID', `${label} نامعتبر است`);
  return new Date(time).toISOString();
}

function assertExam(db, leagueId, examId) {
  const exam = db.prepare('SELECT * FROM exams WHERE id = ? AND league_id = ?').get(examId, leagueId);
  if (!exam) throw notFound('آزمون یافت نشد');
  return exam;
}

const EXAM_COLUMNS = `
  e.id, e.league_id AS leagueId, e.title, e.description, e.subject,
  e.duration_minutes AS durationMinutes, e.pass_percent AS passPercent,
  e.max_attempts AS maxAttempts, e.shuffle_questions AS shuffleQuestions,
  e.shuffle_options AS shuffleOptions, e.show_answers AS showAnswers,
  e.reward_points AS rewardPoints, e.status, e.opens_at AS opensAt,
  e.closes_at AS closesAt, e.created_at AS createdAt, e.updated_at AS updatedAt
`;

function serializeExamRow(row, extra = {}) {
  return {
    id: row.id,
    leagueId: row.leagueId,
    title: row.title,
    description: row.description ?? '',
    subject: row.subject ?? '',
    durationMinutes: row.durationMinutes,
    passPercent: row.passPercent,
    maxAttempts: row.maxAttempts,
    shuffleQuestions: toBool(row.shuffleQuestions),
    shuffleOptions: toBool(row.shuffleOptions),
    showAnswers: toBool(row.showAnswers),
    rewardPoints: row.rewardPoints ?? 0,
    status: row.status,
    opensAt: row.opensAt ?? null,
    closesAt: row.closesAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...extra,
  };
}

function questionsForExam(db, examId) {
  const rows = db.prepare(`
    SELECT q.id, q.body, q.points, q.is_open AS isOpen, q.created_at AS createdAt,
           q.options_json AS optionsJson, q.correct_index AS correctIndex,
           q.explanation, q.difficulty, q.subject,
           eq.position, eq.points AS examPoints
    FROM exam_questions eq
    JOIN questions q ON q.id = eq.question_id
    WHERE eq.exam_id = ?
    ORDER BY eq.position ASC, eq.id ASC
  `).all(examId);
  return rows.map((row) => ({
    ...serializeQuestion(row, { includeCorrectIndex: true }),
    points: row.examPoints ?? row.points,
    explanation: row.explanation ?? '',
    difficulty: row.difficulty ?? 'medium',
    subject: row.subject ?? '',
    position: row.position,
  }));
}

function examStats(db, examId) {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM exam_questions WHERE exam_id = ?) AS questionCount,
      (SELECT COUNT(*) FROM exam_attempts WHERE exam_id = ? AND status = 'submitted') AS attemptCount,
      (SELECT COUNT(DISTINCT student_id) FROM exam_attempts WHERE exam_id = ? AND status = 'submitted') AS studentCount,
      (SELECT COALESCE(AVG(percent), 0) FROM exam_attempts WHERE exam_id = ? AND status = 'submitted') AS avgPercent,
      (SELECT COUNT(*) FROM exam_attempts WHERE exam_id = ? AND status = 'submitted' AND passed = 1) AS passCount
  `).get(examId, examId, examId, examId, examId);
  const attempted = row.studentCount ?? 0;
  return {
    questionCount: row.questionCount ?? 0,
    attemptCount: row.attemptCount ?? 0,
    studentCount: attempted,
    avgPercent: Math.round(row.avgPercent ?? 0),
    passRate: percentOf(row.passCount ?? 0, row.attemptCount ?? 0),
  };
}

function studentAttemptSummary(db, examId, studentId) {
  const rows = db.prepare(`
    SELECT id, attempt_no AS attemptNo, status, percent, passed, score_points AS scorePoints,
           max_points AS maxPoints, awarded_points AS awardedPoints,
           started_at AS startedAt, submitted_at AS submittedAt, expires_at AS expiresAt
    FROM exam_attempts WHERE exam_id = ? AND student_id = ? ORDER BY id DESC
  `).all(examId, studentId);
  const submitted = rows.filter((row) => row.status === 'submitted');
  const best = submitted.reduce((top, row) => (top === null || row.percent > top.percent ? row : top), null);
  return {
    attemptsUsed: rows.length,
    submittedCount: submitted.length,
    bestPercent: best?.percent ?? null,
    bestPassed: best ? toBool(best.passed) : null,
    inProgress: rows.find((row) => row.status === 'in_progress') ?? null,
    last: rows[0] ?? null,
  };
}

function availability(exam, summary, now = nowMs()) {
  if (exam.status === 'draft') return { available: false, state: 'draft' };
  if (exam.status === 'closed') return { available: false, state: 'closed' };
  if (exam.opensAt && Date.parse(exam.opensAt) > now) return { available: false, state: 'upcoming' };
  if (exam.closesAt && Date.parse(exam.closesAt) < now) return { available: false, state: 'closed' };
  if (summary.inProgress) return { available: true, state: 'resume' };
  if (summary.attemptsUsed >= exam.maxAttempts) return { available: false, state: 'exhausted' };
  return { available: true, state: 'open' };
}

export function listExams(db, leagueId) {
  const rows = db.prepare(`SELECT ${EXAM_COLUMNS} FROM exams e WHERE e.league_id = ? ORDER BY e.id DESC`).all(leagueId);
  const items = rows.map((row) => serializeExamRow(row, examStats(db, row.id)));
  return {
    items,
    stats: {
      total: items.length,
      published: items.filter((item) => item.status === 'published').length,
      drafts: items.filter((item) => item.status === 'draft').length,
      attempts: items.reduce((sum, item) => sum + item.attemptCount, 0),
    },
  };
}

export function getTeacherExam(db, leagueId, examId) {
  const row = db.prepare(`SELECT ${EXAM_COLUMNS} FROM exams e WHERE e.id = ? AND e.league_id = ?`).get(examId, leagueId);
  if (!row) throw notFound('آزمون یافت نشد');
  return { exam: serializeExamRow(row, examStats(db, examId)), questions: questionsForExam(db, examId) };
}

function assertQuestionIds(db, leagueId, questionIds) {
  const unique = [...new Set(questionIds)];
  if (unique.length === 0) throw badRequest('QUESTIONS_REQUIRED', 'حداقل یک سؤال انتخاب کنید');
  const placeholders = unique.map(() => '?').join(', ');
  const rows = db.prepare(`SELECT id, body, options_json, correct_index FROM questions WHERE league_id = ? AND id IN (${placeholders})`)
    .all(leagueId, ...unique);
  if (rows.length !== unique.length) throw badRequest('QUESTION_NOT_FOUND', 'برخی سؤال‌ها در این لیگ نیستند');
  const textOnly = rows.find((row) => parseStoredOptions(row.options_json).length < MIN_OPTIONS);
  if (textOnly) throw badRequest('QUESTION_NOT_MCQ', `سؤال «${String(textOnly.body).slice(0, 40)}» چندگزینه‌ای نیست`);
  return unique;
}

function replaceExamQuestions(db, leagueId, examId, questionIds) {
  const unique = assertQuestionIds(db, leagueId, questionIds);
  db.prepare('DELETE FROM exam_questions WHERE exam_id = ?').run(examId);
  const insert = db.prepare(`
    INSERT INTO exam_questions (exam_id, question_id, position, points)
    VALUES (?, ?, ?, ?)
  `);
  unique.forEach((questionId, index) => {
    const question = db.prepare('SELECT points FROM questions WHERE id = ?').get(questionId);
    insert.run(examId, questionId, index, question?.points ?? 0);
  });
}

export function createExam(db, leagueId, teacherId, input) {
  const now = isoNow();
  const run = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO exams
        (league_id, teacher_id, title, description, subject, duration_minutes, pass_percent,
         max_attempts, shuffle_questions, shuffle_options, show_answers, reward_points,
         status, opens_at, closes_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
    `).run(
      leagueId,
      teacherId,
      input.title,
      input.description ?? '',
      input.subject ?? '',
      input.durationMinutes ?? 20,
      input.passPercent ?? 50,
      input.maxAttempts ?? 1,
      input.shuffleQuestions === false ? 0 : 1,
      input.shuffleOptions === false ? 0 : 1,
      input.showAnswers === false ? 0 : 1,
      input.rewardPoints ?? 0,
      normalizeDate(input.opensAt, 'زمان شروع'),
      normalizeDate(input.closesAt, 'زمان پایان'),
      now,
      now,
    );
    const examId = Number(info.lastInsertRowid);
    replaceExamQuestions(db, leagueId, examId, input.questionIds);
    return examId;
  });
  return getTeacherExam(db, leagueId, run());
}

const UPDATABLE = {
  title: 'title',
  description: 'description',
  subject: 'subject',
  durationMinutes: 'duration_minutes',
  passPercent: 'pass_percent',
  maxAttempts: 'max_attempts',
  shuffleQuestions: 'shuffle_questions',
  shuffleOptions: 'shuffle_options',
  showAnswers: 'show_answers',
  rewardPoints: 'reward_points',
};

export function updateExam(db, leagueId, examId, input) {
  assertExam(db, leagueId, examId);
  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (input[key] === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(typeof input[key] === 'boolean' ? (input[key] ? 1 : 0) : input[key]);
  }
  if (input.opensAt !== undefined) {
    sets.push('opens_at = ?');
    values.push(normalizeDate(input.opensAt, 'زمان شروع'));
  }
  if (input.closesAt !== undefined) {
    sets.push('closes_at = ?');
    values.push(normalizeDate(input.closesAt, 'زمان پایان'));
  }
  const run = db.transaction(() => {
    if (sets.length) {
      sets.push('updated_at = ?');
      values.push(isoNow(), examId, leagueId);
      db.prepare(`UPDATE exams SET ${sets.join(', ')} WHERE id = ? AND league_id = ?`).run(...values);
    }
    if (input.questionIds !== undefined) replaceExamQuestions(db, leagueId, examId, input.questionIds);
  });
  run();
  return getTeacherExam(db, leagueId, examId);
}

export function setExamStatus(db, leagueId, examId, status) {
  const exam = assertExam(db, leagueId, examId);
  if (status === 'published') {
    const count = db.prepare('SELECT COUNT(*) AS n FROM exam_questions WHERE exam_id = ?').get(exam.id).n;
    if (!count) throw badRequest('EXAM_EMPTY', 'برای انتشار، حداقل یک سؤال لازم است');
  }
  db.prepare('UPDATE exams SET status = ?, updated_at = ? WHERE id = ?').run(status, isoNow(), exam.id);
  return getTeacherExam(db, leagueId, examId);
}

export function deleteExam(db, leagueId, examId) {
  assertExam(db, leagueId, examId);
  db.prepare('DELETE FROM exams WHERE id = ? AND league_id = ?').run(examId, leagueId);
}

/* ---------------------------------------------------------------- student */

function finalizeExpired(db, attempt) {
  if (!attempt || attempt.status !== 'in_progress') return attempt;
  if (Date.parse(attempt.expires_at ?? attempt.expiresAt) > nowMs()) return attempt;
  return gradeAttempt(db, attempt.id);
}

export function listStudentExams(db, student) {
  const rows = db.prepare(`
    SELECT ${EXAM_COLUMNS} FROM exams e
    WHERE e.league_id = ? AND e.status != 'draft'
    ORDER BY CASE e.status WHEN 'published' THEN 0 ELSE 1 END, e.id DESC
  `).all(student.leagueId);

  const items = rows.map((row) => {
    const exam = serializeExamRow(row);
    const summary = studentAttemptSummary(db, exam.id, student.id);
    if (summary.inProgress) finalizeExpired(db, {
      id: summary.inProgress.id,
      status: summary.inProgress.status,
      expires_at: summary.inProgress.expiresAt,
    });
    const refreshed = studentAttemptSummary(db, exam.id, student.id);
    const status = availability(exam, refreshed);
    return {
      ...exam,
      questionCount: db.prepare('SELECT COUNT(*) AS n FROM exam_questions WHERE exam_id = ?').get(exam.id).n,
      attemptsUsed: refreshed.attemptsUsed,
      attemptsRemaining: Math.max(0, exam.maxAttempts - refreshed.attemptsUsed),
      bestPercent: refreshed.bestPercent,
      bestPassed: refreshed.bestPassed,
      lastAttempt: refreshed.last,
      inProgressAttemptId: refreshed.inProgress?.id ?? null,
      ...status,
    };
  });
  return { items };
}

function loadAttemptForStudent(db, student, attemptId) {
  const attempt = db.prepare(`
    SELECT a.*, e.title, e.duration_minutes AS durationMinutes, e.show_answers AS showAnswers,
           e.pass_percent AS passPercent, e.reward_points AS rewardPoints, e.league_id AS leagueId
    FROM exam_attempts a JOIN exams e ON e.id = a.exam_id
    WHERE a.id = ? AND a.student_id = ?
  `).get(attemptId, student.id);
  if (!attempt || attempt.leagueId !== student.leagueId) throw notFound('آزمون یافت نشد');
  return finalizeExpired(db, attempt);
}

function attemptAnswers(db, attemptId) {
  return db.prepare(`
    SELECT id, question_id AS questionId, position, body, options_json AS optionsJson,
           correct_index AS correctIndex, points, selected_index AS selectedIndex,
           is_correct AS isCorrect, awarded
    FROM exam_attempt_answers WHERE attempt_id = ? ORDER BY position ASC
  `).all(attemptId);
}

function serializeAttempt(attempt) {
  return {
    id: attempt.id,
    examId: attempt.exam_id ?? attempt.examId,
    attemptNo: attempt.attempt_no ?? attempt.attemptNo,
    status: attempt.status,
    startedAt: attempt.started_at ?? attempt.startedAt,
    expiresAt: attempt.expires_at ?? attempt.expiresAt,
    submittedAt: attempt.submitted_at ?? attempt.submittedAt,
    totalQuestions: attempt.total_questions ?? attempt.totalQuestions,
    correctCount: attempt.correct_count ?? attempt.correctCount,
    maxPoints: attempt.max_points ?? attempt.maxPoints,
    scorePoints: attempt.score_points ?? attempt.scorePoints,
    percent: attempt.percent,
    passed: toBool(attempt.passed),
    awardedPoints: attempt.awarded_points ?? attempt.awardedPoints,
  };
}

function publicAttemptPayload(db, attempt, { includeReview }) {
  const answers = attemptAnswers(db, attempt.id);
  const questions = answers.map((answer) => {
    const options = parseJsonArray(answer.optionsJson);
    const question = {
      id: answer.id,
      questionId: answer.questionId,
      position: answer.position,
      body: answer.body,
      options,
      points: answer.points,
      selectedIndex: answer.selectedIndex,
    };
    if (includeReview) {
      question.correctIndex = answer.correctIndex;
      question.isCorrect = answer.isCorrect === null ? null : toBool(answer.isCorrect);
      question.awarded = answer.awarded;
    }
    return question;
  });
  return {
    attempt: serializeAttempt(attempt),
    exam: {
      id: attempt.exam_id ?? attempt.examId,
      title: attempt.title,
      durationMinutes: attempt.durationMinutes,
      passPercent: attempt.passPercent,
      showAnswers: toBool(attempt.showAnswers),
      rewardPoints: attempt.rewardPoints ?? 0,
    },
    questions,
    serverNow: isoNow(),
    remainingSeconds: Math.max(0, Math.floor((Date.parse(attempt.expires_at ?? attempt.expiresAt) - nowMs()) / 1000)),
  };
}

export function startAttempt(db, student, examId) {
  const exam = db.prepare(`SELECT ${EXAM_COLUMNS} FROM exams e WHERE e.id = ? AND e.league_id = ?`).get(examId, student.leagueId);
  if (!exam) throw notFound('آزمون یافت نشد');
  const serialized = serializeExamRow(exam);
  if (serialized.status === 'draft') throw badRequest('EXAM_NOT_PUBLISHED', 'این آزمون هنوز منتشر نشده است');
  const summary = studentAttemptSummary(db, exam.id, student.id);
  if (summary.inProgress) {
    const current = loadAttemptForStudent(db, student, summary.inProgress.id);
    if (current.status === 'in_progress') {
      return publicAttemptPayload(db, current, { includeReview: false });
    }
  }

  const state = availability(serialized, studentAttemptSummary(db, exam.id, student.id));
  if (state.state === 'upcoming') throw badRequest('EXAM_NOT_OPEN', 'زمان شروع آزمون فرا نرسیده است');
  if (state.state === 'closed') throw badRequest('EXAM_CLOSED', 'این آزمون بسته شده است');
  if (state.state === 'exhausted') throw badRequest('ATTEMPTS_EXHAUSTED', 'شما به حداکثر تعداد تلاش رسیده‌اید');

  const questions = db.prepare(`
    SELECT q.id, q.body, q.points, q.options_json AS optionsJson, q.correct_index AS correctIndex
    FROM exam_questions eq JOIN questions q ON q.id = eq.question_id
    WHERE eq.exam_id = ? ORDER BY eq.position ASC, eq.id ASC
  `).all(exam.id);
  if (questions.length === 0) throw badRequest('EXAM_EMPTY', 'این آزمون سؤالی ندارد');

  const ordered = serialized.shuffleQuestions ? shuffled(questions) : questions;
  const snapshots = ordered.map((question) => {
    const options = parseStoredOptions(question.optionsJson);
    let correctIndex = Number(question.correctIndex);
    let displayed = options;
    if (serialized.shuffleOptions) {
      const correctOption = options[correctIndex];
      displayed = shuffled(options);
      correctIndex = displayed.indexOf(correctOption);
    }
    return {
      questionId: question.id,
      body: question.body,
      points: question.points,
      options: displayed,
      correctIndex,
    };
  });

  const attemptId = db.transaction(() => {
    const now = isoNow();
    const started = nowMs();
    const expiresAt = new Date(started + serialized.durationMinutes * 60_000).toISOString();
    const info = db.prepare(`
      INSERT INTO exam_attempts
        (exam_id, student_id, attempt_no, status, started_at, expires_at,
         total_questions, max_points, created_at)
      VALUES (?, ?, ?, 'in_progress', ?, ?, ?, ?, ?)
    `).run(
      exam.id,
      student.id,
      summary.attemptsUsed + 1,
      now,
      expiresAt,
      snapshots.length,
      snapshots.reduce((sum, item) => sum + item.points, 0),
      now,
    );
    const id = Number(info.lastInsertRowid);
    const insert = db.prepare(`
      INSERT INTO exam_attempt_answers
        (attempt_id, question_id, position, body, options_json, correct_index, points, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    snapshots.forEach((item, position) => {
      insert.run(id, item.questionId, position, item.body, JSON.stringify(item.options), item.correctIndex, item.points, now, now);
    });
    return id;
  })();

  return publicAttemptPayload(db, loadAttemptForStudent(db, student, attemptId), { includeReview: false });
}

export function getStudentAttempt(db, student, attemptId) {
  const attempt = loadAttemptForStudent(db, student, attemptId);
  const includeReview = attempt.status === 'submitted' && toBool(attempt.showAnswers);
  const payload = publicAttemptPayload(db, attempt, { includeReview });
  if (attempt.status === 'submitted') {
    payload.result = {
      passed: toBool(attempt.passed),
      percent: attempt.percent,
      correctCount: attempt.correct_count,
      totalQuestions: attempt.total_questions,
      scorePoints: attempt.score_points,
      maxPoints: attempt.max_points,
      awardedPoints: attempt.awarded_points,
    };
  }
  return payload;
}

export function saveAttemptAnswer(db, student, attemptId, answerId, optionIndex) {
  const attempt = loadAttemptForStudent(db, student, attemptId);
  if (attempt.status !== 'in_progress') throw badRequest('ATTEMPT_FINISHED', 'این آزمون قبلاً ثبت شده است');
  const answer = db.prepare('SELECT * FROM exam_attempt_answers WHERE id = ? AND attempt_id = ?').get(answerId, attempt.id);
  if (!answer) throw notFound('سؤال آزمون یافت نشد');
  const options = parseJsonArray(answer.options_json);
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= options.length) {
    throw badRequest('OPTION_INVALID', 'گزینه انتخاب‌شده معتبر نیست');
  }
  db.prepare('UPDATE exam_attempt_answers SET selected_index = ?, updated_at = ? WHERE id = ?')
    .run(optionIndex, isoNow(), answer.id);
  return { ok: true, answerId: answer.id, optionIndex };
}

export function gradeAttempt(db, attemptId) {
  const attempt = db.prepare('SELECT * FROM exam_attempts WHERE id = ?').get(attemptId);
  if (!attempt) throw notFound('آزمون یافت نشد');
  if (attempt.status === 'submitted') return attempt;

  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(attempt.exam_id);
  const answers = db.prepare('SELECT * FROM exam_attempt_answers WHERE attempt_id = ? ORDER BY position ASC').all(attempt.id);
  const total = answers.length;
  let correct = 0;
  let score = 0;
  let maxPoints = 0;
  const updates = answers.map((answer) => {
    maxPoints += answer.points;
    const isCorrect = answer.selected_index !== null && answer.selected_index === answer.correct_index;
    if (isCorrect) {
      correct += 1;
      score += answer.points;
    }
    return { id: answer.id, isCorrect: isCorrect ? 1 : 0, awarded: isCorrect ? answer.points : 0 };
  });
  const percent = percentOf(correct, total);
  const passed = percent >= (exam?.pass_percent ?? 50) ? 1 : 0;
  const rewardPoints = exam?.reward_points ?? 0;
  const awardedPoints = rewardPoints > 0 ? Math.round((rewardPoints * percent) / 100) : 0;
  const now = isoNow();

  const run = db.transaction(() => {
    const update = db.prepare('UPDATE exam_attempt_answers SET is_correct = ?, awarded = ?, updated_at = ? WHERE id = ?');
    updates.forEach((item) => update.run(item.isCorrect, item.awarded, now, item.id));
    db.prepare(`
      UPDATE exam_attempts
      SET status = 'submitted', submitted_at = ?, correct_count = ?, score_points = ?,
          max_points = ?, percent = ?, passed = ?, awarded_points = ?, total_questions = ?
      WHERE id = ?
    `).run(now, correct, score, maxPoints, percent, passed, awardedPoints, total, attempt.id);

    if (awardedPoints > 0) {
      const student = db.prepare('SELECT * FROM students WHERE id = ?').get(attempt.student_id);
      const column = student ? findDisciplineColumn(db, student.league_id) : null;
      if (student && column) {
        applyScoreDelta(db, {
          leagueId: student.league_id,
          student,
          column,
          delta: awardedPoints,
          reason: `نمره آزمون: ${String(exam?.title ?? '').slice(0, 60)}`,
          actor: null,
        });
      }
    }
  });
  run();
  return db.prepare('SELECT * FROM exam_attempts WHERE id = ?').get(attempt.id);
}

export function submitAttempt(db, student, attemptId) {
  const attempt = loadAttemptForStudent(db, student, attemptId);
  if (attempt.status !== 'submitted') gradeAttempt(db, attempt.id);
  return getStudentAttempt(db, student, attempt.id);
}

/* --------------------------------------------------------------- teacher */

export function examResults(db, leagueId, examId) {
  const { exam } = getTeacherExam(db, leagueId, examId);
  const attempts = db.prepare(`
    SELECT a.id, a.attempt_no AS attemptNo, a.status, a.started_at AS startedAt,
           a.submitted_at AS submittedAt, a.correct_count AS correctCount,
           a.total_questions AS totalQuestions, a.score_points AS scorePoints,
           a.max_points AS maxPoints, a.percent, a.passed, a.awarded_points AS awardedPoints,
           s.id AS studentId, s.name AS studentName
    FROM exam_attempts a JOIN students s ON s.id = a.student_id
    WHERE a.exam_id = ? AND a.status = 'submitted'
    ORDER BY a.id DESC
  `).all(examId).map((row) => ({ ...row, passed: toBool(row.passed) }));

  const percents = attempts.map((row) => row.percent);
  const summary = {
    attempts: attempts.length,
    students: new Set(attempts.map((row) => row.studentId)).size,
    avgPercent: percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : 0,
    highest: percents.length ? Math.max(...percents) : 0,
    lowest: percents.length ? Math.min(...percents) : 0,
    passRate: percentOf(attempts.filter((row) => row.passed).length, attempts.length),
    awardedPoints: attempts.reduce((sum, row) => sum + (row.awardedPoints ?? 0), 0),
  };

  const rows = db.prepare(`
    SELECT ea.question_id AS questionId, MAX(ea.body) AS body,
           COUNT(*) AS total,
           SUM(CASE WHEN ea.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
           SUM(CASE WHEN ea.selected_index IS NULL THEN 1 ELSE 0 END) AS unanswered
    FROM exam_attempt_answers ea
    JOIN exam_attempts a ON a.id = ea.attempt_id
    WHERE a.exam_id = ? AND a.status = 'submitted'
    GROUP BY COALESCE(ea.question_id, -ea.id)
    ORDER BY MIN(ea.position)
  `).all(examId);
  const analytics = rows.map((row) => {
    const total = row.total ?? 0;
    const correct = row.correct ?? 0;
    const percent = percentOf(correct, total);
    return {
      questionId: row.questionId,
      body: row.body,
      total,
      correct,
      unanswered: row.unanswered ?? 0,
      percent,
      difficulty: percent >= 75 ? 'easy' : percent >= 40 ? 'medium' : 'hard',
    };
  });

  return { exam, summary, attempts, analytics };
}
