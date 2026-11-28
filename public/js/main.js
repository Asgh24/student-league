/** Application bootstrap: shell wiring, route table and session restoration. */

import { logout as apiLogout, me as apiMe, meta as apiMeta, setCsrfToken } from './api.js';
import { refreshAdminPendingBadge, startAdminBadgePolling } from './adminBadge.js';
import { el } from './dom.js';
import { errorMessage } from './format.js';
import { createRouter, currentPath } from './router.js';
import {
  bindShellHandlers,
  closeDrawer,
  renderDrawerFoot,
  renderDrawerNav,
  setDrawerTitle,
  setLeaguePill,
  setUserPill,
  showTopbar,
} from './shell.js';
import { homePath, can, isAdmin, isAssistant, isStudent, isTeacher, setLeagueId, setMeta, setUser, state, storedLeagueId, subscribe } from './store.js';
import { initInstallPrompt } from './installApp.js';
import { initPalette, openPaletteDialog } from './theme.js';
import { startUpdateNotifier } from './updateNotifier.js';
import { notify } from './ui.js';

import { renderLogin } from './views/login.js';
// The guest support dialog is tiny and shared by the header/footer buttons.
import { openGuestSupportDialog } from './views/guestSupport.js';

/**
 * Every other screen is loaded on demand. The login page is the first thing a
 * visitor sees, and without this it paid for every teacher, student and admin
 * module (hundreds of kilobytes) before it could paint. `loadView` keeps the
 * route table declarative while importing the module only when it is visited.
 */
function loadView(loader, exportName) {
  return async (ctx) => {
    const module = await loader();
    if (typeof module[exportName] !== 'function') {
      throw new Error(`view module does not export ${exportName}`);
    }
    return module[exportName](ctx);
  };
}


const LEAGUE_NAV = [
  ['', '🏆', 'لیگ انفرادی', 'scores'],
  ['teams', '🛡️', 'لیگ تیمی', 'teams'],
  ['attendance', '🗓️', 'حضور و غیاب', 'attendance'],
  ['discipline', '📏', 'انضباط', 'discipline'],
  ['evaluations', '📝', 'ارزشیابی', 'evaluations'],
  ['report-cards', '📊', 'کارنامه دانش‌آموز', 'evaluations'],
  ['raffle', '🎲', 'قرعه‌کشی', 'raffle'],
  ['representative', '👑', 'نماینده کلاس', 'representative'],
  ['wheel', '🎡', 'گردونه شانس', 'wheel'],
  ['live', '📺', 'تابلوی زنده', 'live'],
  ['timer', '⏱️', 'تایمر و ابزار', 'timer'],
  ['qa', '🧪', 'آزمون‌ها', 'qa'],
  ['homework', '📚', 'تکالیف', 'homework'],
  ['schedule', '🗂️', 'برنامه هفتگی', 'schedule'],
  ['files', '📎', 'ارسال فایل', 'files'],
  ['seating', '🪑', 'جای‌گیری', 'seating'],
  ['contacts', '📱', 'شماره‌ها', 'contacts'],
  ['reports', '📨', 'گزارش روزانه', 'reports'],
];

function leagueNavItems() {
  const base = `teacher/league/${state.leagueId}`;
  const active = currentPath();
  return LEAGUE_NAV
    .filter(([, , , permission]) => !isAssistant() || can(permission))
    .map(([suffix, icon, label]) => {
      const href = suffix ? `${base}/${suffix}` : base;
      return { label, icon, href, active: active === href };
    });
}

function teacherNav() {
  const active = currentPath();
  const items = isAssistant()
    ? [
      { group: 'پنل همیار' },
      { label: 'میزکار همیار', icon: '🏠', href: 'teacher', active: active === 'teacher' },
    ]
    : [
      { group: 'میزکار' },
      { label: 'میزکار معلم', icon: '🏠', href: 'teacher', active: active === 'teacher' },
      { label: 'مدیریت دانش‌آموزان', icon: '🧑‍🎓', href: 'teacher/students', active: active === 'teacher/students' },
    ];
  if (state.leagueId) {
    items.push({ group: 'لیگ فعال' });
    items.push(...leagueNavItems());
  }
  if (!isAssistant()) {
    items.push({ group: 'ارتباط و اشتراک' });
    items.push({ label: 'پیام‌ها', icon: '💬', href: 'teacher/messages', active: active === 'teacher/messages' });
    items.push({ label: 'پشتیبانی', icon: '🛎️', href: 'teacher/support', active: active === 'teacher/support' });
    items.push({ label: 'اشتراک من', icon: '💳', href: 'teacher/subscription', active: active === 'teacher/subscription' });
  }
  items.push({ group: 'حساب کاربری' });
  if (!isAssistant()) {
    items.push({ label: 'همیاران سایت', icon: '🤝', href: 'teacher/assistants', active: active === 'teacher/assistants' });
  }
  items.push({ label: 'تنظیمات', icon: '⚙️', href: 'teacher/settings', active: active === 'teacher/settings' });
  items.push({ label: 'سرگرمی', icon: '🎮', href: 'fun', active: active === 'fun' });
  return items;
}

function adminNav() {
  const active = currentPath();
  const tabs = [
    ['admin', '📊', 'داشبورد'],
    ['admin/teachers', '👩‍🏫', 'معلمان'],
    ['admin/expired-users', '🗑️', 'حذف منقضی‌ها'],
    ['admin/plans', '🛍️', 'طرح‌های اشتراک'],
    ['admin/payments', '🧾', 'پرداخت‌ها'],
    ['admin/payment-settings', '💳', 'کارت و پرداخت'],
    ['admin/sms', '📨', 'پنل پیامک'],
    ['admin/support', '🛎️', 'پشتیبانی'],
    ['admin/backup', '🗄️', 'بکاپ و بازیابی'],
    ['admin/settings', '⚙️', 'تنظیمات'],
  ];
  return [
    { group: 'پنل مدیر' },
    ...tabs.map(([href, icon, label]) => ({
      label,
      icon,
      href,
      active: active === href,
      badge: href === 'admin/payments' ? state.adminPendingPayments : undefined,
    })),
  ];
}

function studentNav() {
  const active = currentPath();
  const tabs = [
    ['student', '🏠', 'میزکار'],
    ['student/report-card', '📄', 'کارنامه'],
    ['student/report-cards', '📊', 'کارنامه دستی'],
    ['student/evaluations', '📝', 'ارزشیابی'],
    ['student/attendance', '🗓️', 'حضور و غیاب'],
    ['student/homework', '📚', 'تکالیف'],
    ['student/schedule', '📅', 'برنامه هفتگی'],
    ['student/team', '🛡️', 'تیم من'],
    ['student/history', '📜', 'تاریخچه'],
    ['student/ranking', '🏅', 'رده‌بندی'],
    ['student/leagues', '🏆', 'سوابق لیگها'],
    ['student/likes', '💜', 'لایک'],
    ['student/exams', '🧪', 'آزمون‌ها'],
    ['student/questions', '❓', 'پرسش و پاسخ'],
    ['student/messages', '💬', 'پیام‌ها'],
    ['student/support', '🛎️', 'پشتیبانی'],
    ['student/settings', '⚙️', 'تنظیمات'],
    ['fun', '🎮', 'سرگرمی'],
  ];
  return tabs.map(([href, icon, label]) => ({ label, icon, href, active: active === href }));
}

function logoutButton() {
  return el('button.btn.btn--ghost.btn--block', {
    type: 'button',
    onclick: () => {
      void doLogout();
    },
  }, [el('span', { text: '🚪', 'aria-hidden': 'true' }), el('span', { text: 'خروج از حساب' })]);
}

async function doLogout() {
  try {
    await apiLogout();
  } catch {
    /* the session is cleared locally even if the server call fails */
  }
  setCsrfToken(null);
  setUser(null);
  setLeagueId(null);
  closeDrawer();
  window.location.hash = '#/login';
  notify.info('از حساب خود خارج شدید');
}

function renderShell() {
  const loggedIn = Boolean(state.user);
  showTopbar(loggedIn);
  setUserPill();
  setDrawerTitle(state.meta.appName);
  if (!loggedIn) {
    setLeaguePill(null);
    renderDrawerNav([]);
    renderDrawerFoot([]);
    closeDrawer();
    return;
  }
  if (!isTeacher()) setLeaguePill(null);
  renderDrawerNav(isAdmin() ? adminNav() : isTeacher() ? teacherNav() : studentNav());
  renderDrawerFoot(logoutButton());
  if (isAdmin()) void refreshAdminPendingBadge();
}

const routes = [
  {
    path: 'login',
    view: (ctx) => (state.user ? homePath() : renderLogin(ctx)),
  },
  {
    path: '',
    view: () => homePath(),
  },
  { path: 'teacher', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/dashboard.js'), 'renderTeacherDashboard') },
  { path: 'teacher/students', guard: () => (isTeacher() && !isAssistant() ? undefined : 'teacher'), view: loadView(() => import('./views/studentRoster.js'), 'renderStudentRoster') },
  { path: 'teacher/settings', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/settings.js'), 'renderSettings') },
  { path: 'teacher/messages', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/messages.js'), 'renderTeacherMessages') },
  { path: 'teacher/support', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/support.js'), 'renderSupport') },
  { path: 'teacher/subscription', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/subscription.js'), 'renderSubscription') },
  { path: 'teacher/assistants', guard: () => (isTeacher() && !isAssistant() ? undefined : 'teacher'), view: loadView(() => import('./views/assistants.js'), 'renderAssistants') },
  { path: 'teacher/league/:id', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/league.js'), 'renderLeague') },
  { path: 'teacher/league/:id/teams', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/teams.js'), 'renderTeams') },
  { path: 'teacher/league/:id/attendance', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/attendance.js'), 'renderAttendance') },
  { path: 'teacher/league/:id/discipline', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/discipline.js'), 'renderDiscipline') },
  { path: 'teacher/league/:id/evaluations', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/evaluations.js'), 'renderEvaluations') },
  { path: 'teacher/league/:id/raffle', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/raffle.js'), 'renderRaffle') },
  { path: 'teacher/league/:id/representative', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/representative.js'), 'renderRepresentative') },
  { path: 'teacher/league/:id/representative/board', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/representativeBoard.js'), 'renderRepresentativeBoard') },
  { path: 'teacher/league/:id/wheel', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/wheel.js'), 'renderWheel') },
  { path: 'teacher/league/:id/live', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/liveboard.js'), 'renderLiveBoard') },
  { path: 'teacher/league/:id/timer', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/timer.js'), 'renderTimerTools') },
  { path: 'teacher/league/:id/homework', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/homework.js'), 'renderHomework') },
  { path: 'teacher/league/:id/qa', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/qa.js'), 'renderQa') },
  { path: 'teacher/league/:id/schedule', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/schedule.js'), 'renderSchedule') },
  { path: 'teacher/league/:id/files', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/files.js'), 'renderFiles') },
  { path: 'teacher/league/:id/seating', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/seating.js'), 'renderSeating') },
  { path: 'teacher/league/:id/contacts', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/contacts.js'), 'renderContacts') },
  { path: 'teacher/league/:id/reports', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/reports.js'), 'renderReports') },
  // Report cards (separate from daily reports)
  { path: 'teacher/league/:id/report-cards', guard: () => (isTeacher() ? undefined : 'login'), view: loadView(() => import('./views/reportCards.js'), 'renderReportCards') },
  { path: 'admin', guard: () => (isAdmin() ? undefined : 'login'), view: loadView(() => import('./views/admin/dashboard.js'), 'renderAdminDashboard') },
  { path: 'admin/teachers', guard: () => (isAdmin() ? undefined : 'login'), view: loadView(() => import('./views/admin/teachers.js'), 'renderAdminTeachers') },
  { path: 'admin/expired-users', guard: () => (isAdmin() ? undefined : 'login'), view: loadView(() => import('./views/admin/expiredUsers.js'), 'renderAdminExpiredUsers') },
  { path: 'admin/plans', guard: () => (isAdmin() ? undefined : 'login'), view: loadView(() => import('./views/admin/plans.js'), 'renderAdminPlans') },
  { path: 'admin/payments', guard: () => (isAdmin() ? undefined : 'login'), view: loadView(() => import('./views/admin/payments.js'), 'renderAdminPayments') },
  { path: 'admin/payment-settings', guard: () => (isAdmin() ? undefined : 'login'), view: loadView(() => import('./views/admin/paymentSettings.js'), 'renderAdminPaymentSettings') },
  { path: 'admin/sms', guard: () => (isAdmin() ? undefined : 'login'), view: loadView(() => import('./views/admin/sms.js'), 'renderAdminSms') },
  { path: 'admin/support', guard: () => (isAdmin() ? undefined : 'login'), view: loadView(() => import('./views/admin/support.js'), 'renderAdminSupport') },
  { path: 'admin/backup', guard: () => (isAdmin() ? undefined : 'login'), view: loadView(() => import('./views/admin/backup.js'), 'renderAdminBackup') },
  { path: 'admin/settings', guard: () => (isAdmin() ? undefined : 'login'), view: loadView(() => import('./views/settings.js'), 'renderSettings') },
  { path: 'fun', guard: () => (state.user ? undefined : 'login'), view: loadView(() => import('./views/fun.js'), 'renderFun') },
  { path: 'student', guard: () => (isStudent() ? undefined : 'login'), view: loadView(() => import('./views/student/dashboard.js'), 'renderStudentDashboard') },
  { path: 'student/report-card', guard: () => (isStudent() ? undefined : 'login'), view: loadView(() => import('./views/student/reportcard.js'), 'renderReportCard') },
  { path: 'student/evaluations', guard: () => (isStudent() ? undefined : 'login'), view: loadView(() => import('./views/student/evaluations.js'), 'renderStudentEvaluations') },
  { path: 'student/attendance', guard: () => (isStudent() ? undefined : 'login'), view: loadView(() => import('./views/student/attendance.js'), 'renderStudentAttendance') },
  { path: 'student/homework', guard: () => (isStudent() ? undefined : 'login'), view: loadView(() => import('./views/student/homework.js'), 'renderStudentHomework') },
  { path: 'student/schedule', guard: () => (isStudent() ? undefined : 'login'), view: loadView(() => import('./views/student/schedule.js'), 'renderStudentSchedule') },
  { path: 'student/team', guard: () => (isStudent() ? undefined : 'login'), view: loadView(() => import('./views/student/team.js'), 'renderStudentTeam') },
  { path: 'student/history', guard: () => (isStudent() ? undefined : 'login'), view: loadView(() => import('./views/student/history.js'), 'renderStudentHistory') },
  { path: 'student/ranking', guard: () => (isStudent() ? undefined : 'login'), view: loadView(() => import('./views/student/ranking.js'), 'renderStudentRanking') },
  { path: 'student/leagues', guard: () => (isStudent() ? undefined : 'login'), view: loadView(() => import('./views/student/leagueHistory.js'), 'renderStudentLeagueHistory') },
  { path: 'student/likes', guard: () => (isStudent() ? undefined : 'login'), view: loadView(() => import('./views/student/likes.js'), 'renderStudentLikes') },
  { path: 'student/exams', guard: () => (isStudent() ? undefined : 'login'), view: loadView(() => import('./views/student/exams.js'), 'renderStudentExams') },
  { path: 'student/questions', guard: () => (isStudent() ? undefined : 'login'), view: loadView(() => import('./views/student/questions.js'), 'renderStudentQuestions') },
  { path: 'student/messages', guard: () => (isStudent() ? undefined : 'login'), view: loadView(() => import('./views/messages.js'), 'renderStudentMessages') },
  { path: 'student/support', guard: () => (isStudent() ? undefined : 'login'), view: loadView(() => import('./views/support.js'), 'renderSupport') },
  { path: 'student/report-cards', guard: () => (isStudent() ? undefined : 'login'), view: loadView(() => import('./views/student/reportcard-manual.js'), 'renderStudentReportCard') },
  { path: 'student/settings', guard: () => (isStudent() ? undefined : 'login'), view: loadView(() => import('./views/settings.js'), 'renderSettings') },
];

const router = createRouter({
  routes,
  onNavigate() {
    // Reveal the footer only once a view exists; showing it during boot made it
    // jump down the page (a large layout shift on the public landing page).
    document.getElementById('site-footer')?.removeAttribute('hidden');
  },
  onError(error) {
    document.getElementById('site-footer')?.removeAttribute('hidden');
    if (error?.code === 'SUBSCRIPTION_REQUIRED') {
      notify.warn(errorMessage(error));
      void router.navigate('teacher/subscription', { replace: true });
      return;
    }
    notify.error(errorMessage(error));
  },
  fallback() {
    document.getElementById('site-footer')?.removeAttribute('hidden');
    void router.navigate(homePath(), { replace: true });
  },
});

subscribe(renderShell);

/** Top bar + footer "support" buttons: route members, guests get the contact form. */
function openSupport() {
  if (isAdmin()) void router.navigate('admin/support');
  else if (isTeacher() && !isAssistant()) void router.navigate('teacher/support');
  else if (isStudent()) void router.navigate('student/support');
  else openGuestSupportDialog();
}

document.getElementById('support-btn')?.addEventListener('click', () => {
  closeDrawer();
  openSupport();
});
document.getElementById('footer-support')?.addEventListener('click', openSupport);
document.getElementById('palette-btn')?.addEventListener('click', () => {
  closeDrawer();
  openPaletteDialog();
});

bindShellHandlers({
  onLeaguePill: () => {
    void router.navigate('teacher');
  },
});

function paintFooterYear() {
  const node = document.getElementById('footer-year');
  if (!node) return;
  try {
    node.textContent = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric' }).format(new Date());
  } catch {
    node.textContent = new Date().toLocaleDateString('fa-IR');
  }
}

async function boot() {
  initInstallPrompt();
  initPalette();
  paintFooterYear();

  // Meta and the session are independent; requesting them together removes a
  // full round trip before the first screen can render.
  const [metaResult, sessionResult] = await Promise.allSettled([apiMeta(), apiMe()]);

  if (metaResult.status === 'fulfilled') {
    setMeta(metaResult.value ?? {});
  } else {
    setMeta({ appName: 'لیگ جامع دانش‌آموزی' });
  }

  if (sessionResult.status === 'fulfilled') {
    const session = sessionResult.value;
    if (session?.csrfToken) setCsrfToken(session.csrfToken);
    setUser(session?.user ?? null);
  } else {
    setUser(null);
  }

  if (state.user && !state.user.persianDigits) state.persianDigits = false;
  if (state.leagueId === null) setLeagueId(storedLeagueId());

  renderShell();
  startUpdateNotifier({ currentRelease: metaResult.status === 'fulfilled' ? metaResult.value?.release : null });
  startAdminBadgePolling();
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason && reason.name === 'ApiError' && reason.status !== 0) return;
    notify.error(errorMessage(reason));
  });

  const started = router.start();
  if (started && typeof started.catch === 'function') {
    started.catch((error) => notify.error(errorMessage(error)));
  }
  return null;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void boot();
    });
  } else {
    void boot();
  }
}
