import { z } from 'zod';
import { validationError } from './errors.js';

/**
 * Express 5 exposes `req.query` through a prototype getter, so the parsed value
 * is installed as an own, writable property instead of a plain assignment.
 */
function setRequestProperty(req, key, value) {
  Object.defineProperty(req, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Builds an Express middleware that validates `req.body`, `req.query` and
 * `req.params` against the supplied zod schemas and replaces them with the
 * parsed (typed, stripped) values.
 */
export function validate(schemas = {}) {
  return function validateMiddleware(req, _res, next) {
    try {
      if (schemas.params) Object.assign(req.params, schemas.params.parse(req.params));
      if (schemas.query) setRequestProperty(req, 'query', schemas.query.parse(req.query));
      if (schemas.body) setRequestProperty(req, 'body', schemas.body.parse(req.body ?? {}));
      next();
    } catch (err) {
      if (err && err.name === 'ZodError') {
        const details = (err.issues || []).map((issue) => ({
          path: Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path ?? ''),
          message: issue.message,
        }));
        next(validationError(details));
        return;
      }
      next(err);
    }
  };
}

const idString = z.string().regex(/^\d+$/, 'شناسه باید عددی باشد');

/** Query values arrive as strings; an empty value means "not provided". */
const blankToUndefined = (value) => (value === '' || value === undefined || value === null ? undefined : value);
const optionalIdQuery = z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional());
const optionalIsoDateQuery = z.preprocess(
  blankToUndefined,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ نامعتبر است').optional(),
);

export const schemas = {
  idParam: z.object({ id: idString }),
  leagueParam: z.object({ id: idString }),

  pagination: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),

  listQuery: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    search: z.string().trim().max(80).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ نامعتبر است').optional(),
  }),

  login: z.object({
    username: z.string().trim().min(3, 'نام کاربری حداقل ۳ نویسه').max(64),
    password: z.string().min(4, 'گذرواژه حداقل ۴ نویسه').max(200),
  }),

  changePassword: z.object({
    currentPassword: z.string().min(4).max(200),
    newPassword: z.string().min(6, 'گذرواژه جدید حداقل ۶ نویسه').max(200),
  }),

  persianDigits: z.object({ persianDigits: z.boolean() }),

  leagueCreate: z.object({
    name: z.string().trim().min(1, 'نام لیگ الزامی است').max(80),
  }),

  leagueUpdate: z.object({
    name: z.string().trim().min(1).max(80).optional(),
    status: z.enum(['active', 'completed']).optional(),
  }).refine((v) => Object.keys(v).length > 0, { message: 'هیچ تغییری ارسال نشده است' }),

  leagueSettings: z.object({
    individualAffectsTeam: z.boolean().optional(),
    latePenalty: z.coerce.number().int().min(-1000).max(0).optional(),
    absentPenalty: z.coerce.number().int().min(-1000).max(0).optional(),
    grade: z.string().trim().max(40).optional(),
  }),

  /** Report card filters: subject column, Gregorian date range and page size. */
  reportCardQuery: z.object({
    columnId: optionalIdQuery,
    from: optionalIsoDateQuery,
    to: optionalIsoDateQuery,
    limit: z.coerce.number().int().min(1).max(500).default(200),
  }),

  /** Course evaluations: create / update / bulk marks and list filters. */
  evaluationCreate: z.object({
    subject: z.string().trim().min(1, 'نام درس الزامی است').max(60),
    title: z.string().trim().min(1, 'عنوان ارزشیابی الزامی است').max(120),
    level: z.string().trim().max(40).default(''),
    grade: z.string().trim().max(40).default(''),
    kind: z.enum(['numeric', 'descriptive']).default('numeric'),
    scaleMin: z.coerce.number().min(0).max(1000).default(0),
    scaleMax: z.coerce.number().min(1).max(1000).default(20),
    heldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ نامعتبر است'),
    note: z.string().trim().max(500).default(''),
  }).refine((value) => value.scaleMax > value.scaleMin, { message: 'بازهٔ نمره نامعتبر است', path: ['scaleMax'] }),

  /** Mapping of marks to league points (the «تنظیمات امتیازدهی» panel). */
  evaluationScoring: z.object({
    enabled: z.boolean(),
    excellent: z.coerce.number().int().min(-100000).max(100000),
    good: z.coerce.number().int().min(-100000).max(100000),
    fair: z.coerce.number().int().min(-100000).max(100000),
    needsWork: z.coerce.number().int().min(-100000).max(100000),
  }),

  evaluationUpdate: z.object({
    subject: z.string().trim().min(1).max(60).optional(),
    title: z.string().trim().min(1).max(120).optional(),
    level: z.string().trim().max(40).optional(),
    grade: z.string().trim().max(40).optional(),
    kind: z.enum(['numeric', 'descriptive']).optional(),
    scaleMin: z.coerce.number().min(0).max(1000).optional(),
    scaleMax: z.coerce.number().min(1).max(1000).optional(),
    heldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ نامعتبر است').optional(),
    note: z.string().trim().max(500).optional(),
  }).refine((value) => Object.keys(value).length > 0, { message: 'هیچ تغییری ارسال نشده است' }),

  evaluationScores: z.object({
    scores: z.array(z.object({
      studentId: z.coerce.number().int().positive(),
      score: z.preprocess(
        (value) => (value === '' || value === null || value === undefined ? null : value),
        z.coerce.number().min(0).max(1000).nullable(),
      ),
      label: z.string().trim().max(40).default(''),
      note: z.string().trim().max(200).default(''),
    })).max(1000),
  }),

  evaluationsQuery: z.object({
    subject: z.preprocess(blankToUndefined, z.string().trim().max(60).optional()),
    from: optionalIsoDateQuery,
    to: optionalIsoDateQuery,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  }),

  timerSet: z.object({
    days: z.coerce.number().int().min(0).max(3650).default(0),
    hours: z.coerce.number().int().min(0).max(23).default(0),
    minutes: z.coerce.number().int().min(0).max(59).default(0),
    seconds: z.coerce.number().int().min(0).max(59).default(0),
  }),

  studentCreate: z.object({
    name: z.string().trim().min(1, 'نام دانش‌آموز الزامی است').max(80),
    username: z.string().trim().min(3).max(64).optional(),
    password: z.string().min(6).max(200).optional(),
  }),

  studentUpdate: z.object({
    name: z.string().trim().min(1).max(80),
  }),

  studentPassword: z.object({
    password: z.string().min(6, 'گذرواژه حداقل ۶ نویسه').max(200),
  }),

  columnCreate: z.object({
    name: z.string().trim().min(1, 'نام ستون الزامی است').max(40),
    step: z.coerce.number().int().min(1).max(1000).default(25),
  }),

  columnUpdate: z.object({
    name: z.string().trim().min(1).max(40).optional(),
    step: z.coerce.number().int().min(1).max(1000).optional(),
    position: z.coerce.number().int().min(0).max(999).optional(),
  }).refine((v) => Object.keys(v).length > 0, { message: 'هیچ تغییری ارسال نشده است' }),

  columnDeleteQuery: z.object({
    mode: z.enum(['keep', 'discard']).default('discard'),
  }),

  scoreCommit: z.object({
    studentId: z.coerce.number().int().positive(),
    changes: z.array(z.object({
      columnId: z.coerce.number().int().positive(),
      delta: z.coerce.number().int().min(-100000).max(100000),
    })).min(1, 'حداقل یک تغییر لازم است').max(64),
    reason: z.string().trim().max(200).optional(),
  }),

  scoreRecord: z.object({
    studentId: z.coerce.number().int().positive(),
    columnId: z.coerce.number().int().positive(),
    delta: z.coerce.number().int().min(-100000).max(100000).refine((v) => v !== 0, { message: 'مقدار تغییر نباید صفر باشد' }),
    reason: z.string().trim().max(200).optional(),
  }),

  championshipCreate: z.object({
    title: z.string().trim().min(1).max(60).default('قهرمانی'),
    rank: z.coerce.number().int().min(1).max(10).default(1),
  }),

  teamCreate: z.object({
    name: z.string().trim().min(1, 'نام تیم الزامی است').max(60),
    label: z.string().trim().max(60).optional(),
  }),

  teamUpdate: z.object({
    name: z.string().trim().min(1).max(60).optional(),
    label: z.string().trim().max(60).nullable().optional(),
  }).refine((v) => Object.keys(v).length > 0, { message: 'هیچ تغییری ارسال نشده است' }),

  teamAdjust: z.object({
    delta: z.coerce.number().int().min(-100000).max(100000).refine((v) => v !== 0, { message: 'مقدار تغییر نباید صفر باشد' }),
    reason: z.string().trim().max(200).optional(),
  }),

  teamMember: z.object({
    studentId: z.coerce.number().int().positive(),
  }),

  teamAssign: z.object({
    teamId: z.coerce.number().int().positive(),
    studentId: z.coerce.number().int().positive(),
  }),

  attendanceSet: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ نامعتبر است'),
    records: z.array(z.object({
      studentId: z.coerce.number().int().positive(),
      status: z.enum(['present', 'absent', 'late']),
    })).max(500),
  }),

  attendanceBulk: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ نامعتبر است'),
    status: z.enum(['present', 'absent', 'late']),
  }),

  dateQuery: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ نامعتبر است').optional(),
  }),

  raffleDraw: z.object({
    excludePrevious: z.boolean().optional(),
    reason: z.string().trim().max(120).optional(),
  }),

  wheelSave: z.object({
    segments: z.array(z.object({
      label: z.string().trim().min(1).max(40),
    })).min(2, 'حداقل دو بخش لازم است').max(24),
  }),

  homeworkCreate: z.object({
    title: z.string().trim().min(1, 'عنوان تکلیف الزامی است').max(120),
    description: z.string().trim().max(2000).default(''),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ نامعتبر است').nullable().optional(),
  }),

  homeworkUpdate: z.object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }).refine((v) => Object.keys(v).length > 0, { message: 'هیچ تغییری ارسال نشده است' }),

  homeworkStatus: z.object({
    studentId: z.coerce.number().int().positive(),
    status: z.enum(['done', 'not_done']),
  }),

  questionCreate: z.object({
    body: z.string().trim().min(1, 'متن سوال الزامی است').max(500),
    points: z.coerce.number().int().min(0).max(10000).default(0),
  }),

  answerCreate: z.object({
    body: z.string().trim().min(1, 'متن پاسخ الزامی است').max(1000),
  }),

  answerAward: z.object({
    points: z.coerce.number().int().min(0).max(10000),
  }),

  /** «حالت پخش»: one completed presentation run for a single student. */
  quizSessionCreate: z.object({
    studentId: z.coerce.number().int().positive(),
    items: z.array(z.object({
      questionId: z.coerce.number().int().positive(),
      correct: z.boolean(),
    })).min(1, 'حداقل یک سؤال لازم است').max(100),
  }),

  /** «جای‌گیری»: the classroom grid and where every student sits. */
  seatingSave: z.object({
    rows: z.coerce.number().int().min(1).max(20),
    cols: z.coerce.number().int().min(1).max(20),
    seats: z.array(z.object({
      row: z.coerce.number().int().min(0).max(19),
      col: z.coerce.number().int().min(0).max(19),
      studentId: z.coerce.number().int().positive(),
    })).max(400),
  }),

  /** «شماره‌ها»: parent and student mobile numbers (empty = not provided). */
  contactSave: z.object({
    parentPhone: z.string().trim().max(20).default(''),
    studentPhone: z.string().trim().max(20).default(''),
  }),

  /** «گزارش روزانه»: the day plus the students whose parents receive it. */
  dailyReportSend: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ نامعتبر است'),
    studentIds: z.array(z.coerce.number().int().positive()).min(1, 'حداقل یک دانش‌آموز انتخاب کنید').max(200),
  }),

  scheduleSave: z.object({
    slots: z.array(z.object({
      dayIndex: z.coerce.number().int().min(0).max(6),
      period: z.coerce.number().int().min(0).max(20),
      subject: z.string().trim().max(60).default(''),
      note: z.string().trim().max(200).default(''),
    })).max(200),
  }),

  fileUpload: z.object({
    description: z.string().trim().max(300).optional(),
  }),

  likeCreate: z.object({
    toStudentId: z.coerce.number().int().positive(),
    achievement: z.string().trim().max(120).default(''),
  }),
};
