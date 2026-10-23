import { badRequest } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';
import { pickOne } from '../lib/random.js';

const HISTORY_LIMIT = 500;

function ensureCurrentCycle(db, leagueId, now = isoNow()) {
  const findLatest = db.prepare(`
    SELECT cycle, started_at, completed_at
    FROM representative_cycles
    WHERE league_id = ?
    ORDER BY cycle DESC
    LIMIT 1
  `);
  const latest = findLatest.get(leagueId);
  if (latest) return latest;

  db.prepare('INSERT INTO representative_cycles (league_id, cycle, started_at) VALUES (?, 1, ?)')
    .run(leagueId, now);
  return findLatest.get(leagueId);
}

function currentSelections(db, leagueId, cycle) {
  return db.prepare(`
    SELECT id, student_id AS studentId, student_name AS studentName, cycle,
           created_at AS createdAt
    FROM representative_history
    WHERE league_id = ? AND cycle = ?
    ORDER BY id ASC
  `).all(leagueId, cycle);
}

/**
 * Snapshot used by the teacher page. Counts only students that still belong to
 * the league, so deleting a student cannot make progress exceed 100%.
 */
export function representativeState(db, leagueId) {
  const current = ensureCurrentCycle(db, leagueId);
  const students = db.prepare('SELECT id, name FROM students WHERE league_id = ? ORDER BY name ASC, id ASC')
    .all(leagueId);
  const selections = currentSelections(db, leagueId, current.cycle);
  const selectedIds = new Set(selections.map((row) => row.studentId).filter(Boolean));

  const stats = new Map(
    db.prepare(`
      SELECT student_id AS studentId, COUNT(*) AS timesSelected, MAX(created_at) AS lastSelectedAt
      FROM representative_history
      WHERE league_id = ?
      GROUP BY student_id
    `).all(leagueId).map((row) => [row.studentId, row]),
  );

  const status = students.map((student) => {
    const stat = stats.get(student.id);
    return {
      studentId: student.id,
      name: student.name,
      selected: selectedIds.has(student.id),
      timesSelected: stat?.timesSelected ?? 0,
      lastSelectedAt: stat?.lastSelectedAt ?? null,
    };
  });

  const selectedCount = status.filter((student) => student.selected).length;
  const totalStudents = students.length;
  const remainingCount = Math.max(0, totalStudents - selectedCount);
  const completed = totalStudents > 0 && remainingCount === 0;
  const percent = totalStudents ? Math.round((selectedCount / totalStudents) * 100) : 0;

  const history = db.prepare(`
    SELECT id, student_id AS studentId, student_name AS studentName, cycle,
           created_at AS createdAt
    FROM representative_history
    WHERE league_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(leagueId, HISTORY_LIMIT);

  const cycles = db.prepare(`
    SELECT c.cycle, c.started_at AS startedAt, c.completed_at AS completedAt,
           (SELECT COUNT(*) FROM representative_history h
             WHERE h.league_id = c.league_id AND h.cycle = c.cycle) AS selectedCount
    FROM representative_cycles c
    WHERE c.league_id = ?
    ORDER BY c.cycle DESC
  `).all(leagueId);

  return {
    cycle: current.cycle,
    cycleStartedAt: current.started_at,
    cycleCompletedAt: current.completed_at,
    completed,
    totalStudents,
    selectedCount,
    remainingCount,
    percent,
    lastSelected: selections.length ? selections[selections.length - 1] : null,
    students: status,
    history,
    cycles,
  };
}

/** Picks a student who has not had a turn in the current cycle. */
export function drawRepresentative(db, { leagueId, actorId }) {
  const result = db.transaction(() => {
    const current = ensureCurrentCycle(db, leagueId);
    const students = db.prepare('SELECT id, name FROM students WHERE league_id = ? ORDER BY id ASC')
      .all(leagueId);
    if (students.length === 0) {
      throw badRequest('NO_STUDENTS', 'هنوز دانش‌آموزی به این لیگ اضافه نشده است');
    }

    const chosenIds = new Set(
      currentSelections(db, leagueId, current.cycle)
        .map((row) => row.studentId)
        .filter(Boolean),
    );
    const pool = students.filter((student) => !chosenIds.has(student.id));

    if (pool.length === 0) {
      if (!current.completed_at) {
        db.prepare('UPDATE representative_cycles SET completed_at = ? WHERE league_id = ? AND cycle = ?')
          .run(isoNow(), leagueId, current.cycle);
      }
      throw badRequest(
        'CYCLE_COMPLETE',
        'همهٔ دانش‌آموزان در این دور نماینده شده‌اند؛ برای ادامه یک دور جدید شروع کنید',
      );
    }

    const chosen = pickOne(pool);
    const now = isoNow();
    const inserted = db.prepare(`
      INSERT INTO representative_history (league_id, student_id, student_name, cycle, actor_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(leagueId, chosen.id, chosen.name, current.cycle, actorId ?? null, now);

    const remaining = pool.length - 1;
    if (remaining === 0) {
      db.prepare('UPDATE representative_cycles SET completed_at = ? WHERE league_id = ? AND cycle = ?')
        .run(now, leagueId, current.cycle);
    }

    return {
      winner: {
        historyId: Number(inserted.lastInsertRowid),
        studentId: chosen.id,
        name: chosen.name,
      },
      cycle: current.cycle,
      remaining,
      completed: remaining === 0,
    };
  })();

  return { ...result, state: representativeState(db, leagueId) };
}

/**
 * Starts the next cycle. Finishing a cycle early is destructive for the
 * students that have not been picked yet, so the caller must opt in with
 * `force: true`.
 */
export function startRepresentativeCycle(db, { leagueId, force = false }) {
  const current = ensureCurrentCycle(db, leagueId);
  const selectedCount = db.prepare(`
    SELECT COUNT(*) AS n FROM representative_history WHERE league_id = ? AND cycle = ?
  `).get(leagueId, current.cycle).n;
  const totalStudents = db.prepare('SELECT COUNT(*) AS n FROM students WHERE league_id = ?')
    .get(leagueId).n;

  if (selectedCount < totalStudents && !force) {
    throw badRequest(
      'CYCLE_INCOMPLETE',
      'هنوز همهٔ دانش‌آموزان این دور انتخاب نشده‌اند؛ برای شروع دور بعد تأیید کنید',
    );
  }

  const now = isoNow();
  const nextCycle = db.transaction(() => {
    if (!current.completed_at) {
      db.prepare('UPDATE representative_cycles SET completed_at = ? WHERE league_id = ? AND cycle = ?')
        .run(now, leagueId, current.cycle);
    }
    db.prepare('INSERT INTO representative_cycles (league_id, cycle, started_at) VALUES (?, ?, ?)')
      .run(leagueId, current.cycle + 1, now);
    return current.cycle + 1;
  })();

  return { cycle: nextCycle, state: representativeState(db, leagueId) };
}

/** Undo the most recent pick in the current cycle, e.g. after a wrong click. */
export function undoLastRepresentative(db, { leagueId }) {
  const current = ensureCurrentCycle(db, leagueId);
  const latest = db.prepare(`
    SELECT id, student_name AS studentName
    FROM representative_history
    WHERE league_id = ? AND cycle = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(leagueId, current.cycle);

  if (!latest) {
    throw badRequest('NOTHING_TO_UNDO', 'در این دور هنوز نماینده‌ای انتخاب نشده است');
  }

  db.transaction(() => {
    db.prepare('DELETE FROM representative_history WHERE id = ?').run(latest.id);
    db.prepare('UPDATE representative_cycles SET completed_at = NULL WHERE league_id = ? AND cycle = ?')
      .run(leagueId, current.cycle);
  })();

  return {
    removed: { id: latest.id, name: latest.studentName },
    state: representativeState(db, leagueId),
  };
}

/** Wipes every representative record and starts again at cycle 1. */
export function resetRepresentativeHistory(db, { leagueId }) {
  db.transaction(() => {
    db.prepare('DELETE FROM representative_history WHERE league_id = ?').run(leagueId);
    db.prepare('DELETE FROM representative_cycles WHERE league_id = ?').run(leagueId);
    ensureCurrentCycle(db, leagueId);
  })();

  return { state: representativeState(db, leagueId) };
}
