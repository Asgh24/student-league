import { Router } from 'express';
import { asyncHandler, todayIso } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { requireTeacher, loadOwnedLeague, requirePermission, requireOwnerTeacher } from '../middleware/auth.js';
import { dailyReport, sendCustomParentMessages, sendDailyReports } from '../services/dailyReports.js';
import { saveReportChannels } from '../services/reportChannels.js';

/** «گزارش روزانه»: condensed change report sent to parents over sms.ir or Shad. */
export function createLeagueReportsRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db), requirePermission('reports'));

  router.get('/daily', validate({ query: schemas.listQuery }), (req, res) => {
    const date = req.query.date ?? todayIso();
    res.json(dailyReport(db, req.league.id, date));
  });

  /** Teacher-wide switches; stored on the owner account, not on one league. */
  router.put(
    '/channels',
    requireOwnerTeacher,
    validate({ body: schemas.reportChannels }),
    (req, res) => {
      const channels = saveReportChannels(db, req.league.teacher_id, req.body);
      res.json({ channels });
    },
  );

  router.post(
    '/daily/send',
    requireOwnerTeacher,
    validate({ body: schemas.dailyReportSend }),
    asyncHandler(async (req, res) => {
      const payload = await sendDailyReports(db, {
        leagueId: req.league.id,
        date: req.body.date,
        studentIds: req.body.studentIds,
      });
      res.json(payload);
    }),
  );

  /** Free-text message written by the teacher for the selected parents. */
  router.post(
    '/custom/send',
    requireOwnerTeacher,
    validate({ body: schemas.customReportSend }),
    asyncHandler(async (req, res) => {
      const payload = await sendCustomParentMessages(db, {
        leagueId: req.league.id,
        studentIds: req.body.studentIds,
        message: req.body.message,
      });
      res.json(payload);
    }),
  );

  return router;
}
