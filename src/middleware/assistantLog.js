import { logAssistantAction } from '../services/assistants.js';

const SECTION_LABELS = {
  leagues: 'تنظیمات لیگ',
  students: 'دانش‌آموزان',
  columns: 'ستون‌های امتیاز',
  scores: 'امتیازها',
  teams: 'تیم‌ها',
  attendance: 'حضور و غیاب',
  evaluations: 'ارزشیابی',
  homework: 'تکالیف',
  questions: 'سوال و پاسخ',
  answers: 'سوال و پاسخ',
  ai: 'سوال و پاسخ',
  'quiz-sessions': 'سوال و پاسخ',
  schedule: 'برنامه هفتگی',
  files: 'فایل‌ها',
  seating: 'جای‌گیری',
  contacts: 'شماره‌ها',
  reports: 'گزارش روزانه',
  raffle: 'قرعه‌کشی',
  representative: 'نماینده کلاس',
  wheel: 'گردونه شانس',
  live: 'تابلوی زنده',
  timer: 'تایمر',
  messages: 'پیام‌ها',
  auth: 'حساب کاربری',
  tools: 'ابزارها',
};

const METHOD_LABELS = { POST: 'ثبت', PUT: 'ویرایش', PATCH: 'ویرایش', DELETE: 'حذف' };

/** Picks the meaningful section segment out of a short API path. */
export function sectionOf(path) {
  const parts = String(path).split('?')[0].split('/').filter(Boolean);
  let section = parts[0] ?? '';
  if (section === 'leagues') {
    const third = parts[2] ?? '';
    section = third === 'tools' ? (parts[3] ?? 'tools') : (third || 'leagues');
  }
  return section === 'tools' ? (parts[3] ?? 'tools') : section;
}

/**
 * Records successful assistant mutations only. Reads and failed requests are
 * ignored, so the weekly log stays very small. Logging never breaks a request.
 */
export function assistantActionLog(db) {
  return function assistantActionLogMiddleware(req, res, next) {
    if (!req.user?.assistant) return next();
    if (!METHOD_LABELS[req.method]) return next();

    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      try {
        const path = String(req.originalUrl ?? req.url ?? '').split('?')[0].replace(/^\/api\/v1/, '');
        const section = sectionOf(path);
        const label = SECTION_LABELS[section] ?? 'تغییرات';
        logAssistantAction(db, {
          ownerId: req.user.ownerId,
          leagueId: req.user.assistant.leagueId,
          assistantId: req.user.assistant.id,
          assistantName: req.user.displayName,
          action: `${METHOD_LABELS[req.method]} ${label}`,
          detail: `${req.method} ${path}`,
        });
      } catch {
        /* auditing must never break the response */
      }
    });
    return next();
  };
}
