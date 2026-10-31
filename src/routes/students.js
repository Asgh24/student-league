import { Router } from 'express';
import { conflict, forbidden } from '../lib/errors.js';
import { asyncHandler, isoNow } from '../lib/http.js';
import { matchesFa } from '../lib/normalize.js';
import { schemas, validate } from '../lib/validate.js';
import { createUser, findByUsername, findById, updatePassword, updateUsername } from '../repositories/users.js';
import { requireTeacher, loadOwnedLeague, requirePermission, requireOwnerTeacher } from '../middleware/auth.js';
import { ownedStudent } from '../middleware/ownership.js';
import {
  addChampionship,
  attendanceRatios,
  championshipsFor,
  rankingForLeague,
  removeChampionship,
  scoresMatrix,
  studentRank,
  titleForPoints,
} from '../services/scoring.js';
import { getColumns, requireLeague } from '../repositories/leagues.js';
import { studentAttendance } from '../services/attendance.js';
import { studentTeam } from '../services/teams.js';

export function createLeagueStudentsRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db));

  router.get('/', (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    let rows = scoresMatrix(db, req.league.id);
    if (search.trim()) rows = rows.filter((row) => matchesFa(row.name, search));
    res.json({ items: rows, total: rows.length });
  });

  router.post('/', requirePermission('scores'), validate({ body: schemas.studentCreate }), asyncHandler(async (req, res) => {
    const { name, username, password } = req.body;
    if (req.user.assistant && (username || password)) {
      throw forbidden('ساخت حساب کاربری دانش‌آموز فقط توسط معلم اصلی انجام می‌شود');
    }
    if (username && !password) throw conflict('PASSWORD_REQUIRED', 'برای نام کاربری، گذرواژه هم لازم است');
    if (username && findByUsername(db, username)) throw conflict('USERNAME_TAKEN', 'این نام کاربری قبلاً استفاده شده است');

    const create = db.transaction(() => {
      let userId = null;
      if (username) {
        const user = createUser(db, { username, password, role: 'student', displayName: name });
        userId = user.id;
      }
      const info = db.prepare('INSERT INTO students (league_id, user_id, name, created_at) VALUES (?, ?, ?, ?)')
        .run(req.league.id, userId, String(name).trim(), isoNow());
      return Number(info.lastInsertRowid);
    });
    const studentId = create();
    const row = scoresMatrix(db, req.league.id).find((item) => item.id === studentId);
    res.status(201).json({ student: row });
  }));

  return router;
}

export function createStudentsRouter({ db }) {
  const router = Router();
  const owned = [requireTeacher, ownedStudent(db)];

  router.get('/:id', ...owned, (req, res) => {
    const student = req.student;
    const league = requireLeague(db, student.league_id);
    const limit = 50;
    const history = db.prepare(`
      SELECT id, column_id AS columnId, column_name AS columnName, delta, reason, actor_name AS actorName,
             total_after AS totalAfter, created_at AS createdAt
      FROM score_history WHERE student_id = ? ORDER BY id DESC LIMIT ?
    `).all(student.id, limit);
    const { rank, totalStudents, total } = studentRank(db, league.id, student.id);
    const columns = getColumns(db, league.id);
    const values = new Map(db.prepare('SELECT column_id AS columnId, value FROM scores WHERE student_id = ?').all(student.id).map((r) => [r.columnId, r.value]));
    const ratios = attendanceRatios(db, league.id).get(student.id) ?? { attended: 0, recorded: 0 };
    const team = studentTeam(db, league.id, student.id);
    const attendance = studentAttendance(db, student.id, { limit: 14, offset: 0 });
    const account = student.user_id ? findById(db, student.user_id) : null;

    res.json({
      student: {
        id: student.id,
        name: student.name,
        leagueId: league.id,
        hasLogin: student.user_id !== null,
        username: req.user.assistant ? '' : (account?.username ?? ''),
        total,
        rank,
        totalStudents,
        attended: ratios.attended,
        recorded: ratios.recorded,
        title: titleForPoints(total),
        team: team ? { id: team.id, name: team.name, rank: team.rank } : null,
        reportCard: columns.map((column) => ({ columnId: column.id, name: column.name, value: values.get(column.id) ?? 0 })),
        championships: championshipsFor(db, student.id),
        history,
        attendance: attendance.items,
      },
    });
  });

  router.patch('/:id', ...owned, requirePermission('scores'), validate({ body: schemas.studentUpdate }), (req, res) => {
    db.prepare('UPDATE students SET name = ? WHERE id = ?').run(req.body.name.trim(), req.student.id);
    if (req.student.user_id) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(req.body.name.trim(), req.student.user_id);
    }
    res.json({ ok: true, student: { id: req.student.id, name: req.body.name.trim() } });
  });

  router.delete('/:id', ...owned, requirePermission('scores'), (req, res) => {
    const run = db.transaction(() => {
      db.prepare('DELETE FROM students WHERE id = ?').run(req.student.id);
      if (req.student.user_id) db.prepare('DELETE FROM users WHERE id = ? AND role = \'student\'').run(req.student.user_id);
    });
    run();
    res.json({ ok: true });
  });

  router.post('/:id/password', ...owned, requireOwnerTeacher, validate({ body: schemas.studentPassword }), (req, res) => {
    if (!req.student.user_id) throw conflict('NO_LOGIN', 'برای این دانش‌آموز حساب کاربری ساخته نشده است');
    updatePassword(db, req.student.user_id, req.body.password);
    res.json({ ok: true });
  });

  /**
   * Updates the student's login, or creates it when the student has none yet.
   * A field left out keeps its current value; creating a login needs both.
   */
  router.put('/:id/credentials', ...owned, requireOwnerTeacher, validate({ body: schemas.studentCredentials }), (req, res) => {
    const { username, password } = req.body;
    const account = req.student.user_id ? findById(db, req.student.user_id) : null;

    if (!account) {
      if (!username || !password) {
        throw conflict('LOGIN_FIELDS_REQUIRED', 'برای ساخت حساب کاربری، نام کاربری و گذرواژه هر دو لازم است');
      }
      if (findByUsername(db, username)) throw conflict('USERNAME_TAKEN', 'این نام کاربری قبلاً استفاده شده است');
      const create = db.transaction(() => {
        const user = createUser(db, { username, password, role: 'student', displayName: req.student.name });
        db.prepare('UPDATE students SET user_id = ? WHERE id = ?').run(user.id, req.student.id);
        return user;
      });
      const user = create();
      res.status(201).json({ ok: true, student: { id: req.student.id, hasLogin: true, username: user.username } });
      return;
    }

    if (username && username.toLocaleLowerCase() !== account.username.toLocaleLowerCase()) {
      const taken = findByUsername(db, username);
      if (taken && taken.id !== account.id) throw conflict('USERNAME_TAKEN', 'این نام کاربری قبلاً استفاده شده است');
    }
    const run = db.transaction(() => {
      if (username && username !== account.username) updateUsername(db, account.id, username);
      if (password) updatePassword(db, account.id, password);
    });
    run();
    res.json({
      ok: true,
      student: { id: req.student.id, hasLogin: true, username: username || account.username },
    });
  });

  router.post('/:id/championships', ...owned, requirePermission('scores'), validate({ body: schemas.championshipCreate }), (req, res) => {
    const created = addChampionship(db, {
      leagueId: req.student.league_id,
      studentId: req.student.id,
      title: req.body.title,
      rank: req.body.rank,
    });
    res.status(201).json({ championship: created, championships: championshipsFor(db, req.student.id) });
  });

  router.delete('/:id/championships', ...owned, requirePermission('scores'), (req, res) => {
    const removed = removeChampionship(db, { leagueId: req.student.league_id, studentId: req.student.id });
    res.json({ removed, championships: championshipsFor(db, req.student.id) });
  });

  /** Ranking list used by the profile drawer. */
  router.get('/:id/ranking', ...owned, (req, res) => {
    const items = rankingForLeague(db, req.student.league_id).slice(0, 50);
    res.json({ items, total: items.length });
  });

  return router;
}
