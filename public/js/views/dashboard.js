/** Teacher workspace: league switching, summary cards and the tool tiles. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { can, isAssistant, setLeagueId, state } from '../store.js';
import { confirmDialog, emptyState, formDialog, notify, openModal } from '../ui.js';
import { button, card, fa, faDate, grid, loadingNode, pageHead, statCard, tile } from './common.js';

const TOOLS = [
  { suffix: '', icon: '🏆', label: 'لیگ انفرادی', perm: 'scores' },
  { suffix: 'teams', icon: '🛡️', label: 'لیگ تیمی', perm: 'teams' },
  { suffix: 'attendance', icon: '🗓️', label: 'حضور و غیاب', perm: 'attendance' },
  { suffix: 'evaluations', icon: '📝', label: 'ارزشیابی دروس', perm: 'evaluations' },
  { suffix: 'raffle', icon: '🎲', label: 'قرعه‌کشی', perm: 'raffle' },
  { suffix: 'representative', icon: '👑', label: 'نماینده کلاس', perm: 'representative' },
  { suffix: 'live', icon: '📺', label: 'تابلوی زنده', perm: 'live' },
  { suffix: 'timer', icon: '⏱️', label: 'تایمر و ابزار', perm: 'timer' },
  { suffix: 'wheel', icon: '🎡', label: 'گردونه شانس', perm: 'wheel' },
  { suffix: 'qa', icon: '❓', label: 'سوال و پاسخ', perm: 'qa' },
  { suffix: 'homework', icon: '📚', label: 'تکالیف', perm: 'homework' },
  { suffix: 'schedule', icon: '🗂️', label: 'برنامه هفتگی', perm: 'schedule' },
  { suffix: 'files', icon: '📎', label: 'ارسال فایل', perm: 'files' },
  { suffix: 'seating', icon: '🪑', label: 'جای‌گیری', perm: 'seating' },
  { suffix: 'contacts', icon: '📱', label: 'شماره‌ها', perm: 'contacts' },
  { suffix: 'reports', icon: '📨', label: 'گزارش روزانه', perm: 'reports' },
  { href: 'fun', icon: '🎮', label: 'سرگرمی', perm: '' },
];

async function createLeague() {
  const values = await formDialog({
    title: 'ساخت لیگ جدید',
    description: 'برای لیگ جدید ستون‌های پیش‌فرض امتیاز ساخته می‌شود.',
    submitLabel: 'ساخت لیگ',
    fields: [{ name: 'name', label: 'نام لیگ', type: 'text', required: true, placeholder: 'مثلاً کلاس ششم الف' }],
  });
  if (!values) return;
  try {
    const payload = await api.post('/leagues', { name: values.name.trim() });
    setLeagueId(payload?.league?.id ?? null);
    notify.ok('لیگ با موفقیت ساخته شد');
    // Re-render immediately: on a fresh account the dashboard previously kept
    // showing the empty state until a manual page refresh.
    await renderTeacherDashboard();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function renameLeague(league) {
  const values = await formDialog({
    title: 'تغییر نام لیگ',
    submitLabel: 'ذخیره',
    fields: [{ name: 'name', label: 'نام لیگ', type: 'text', value: league.name, required: true }],
  });
  if (!values) return;
  try {
    await api.patch(`/leagues/${league.id}`, { name: values.name.trim() });
    notify.ok('نام لیگ تغییر کرد');
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function completeLeague(league) {
  const agreed = await confirmDialog({
    title: 'پایان لیگ',
    message: 'با پایان لیگ، رتبه‌بندی نهایی ذخیره و به سه نفر برتر عنوان و مدال داده می‌شود. ادامه می‌دهید؟',
    confirmLabel: 'پایان لیگ',
  });
  if (!agreed) return;
  try {
    const payload = await api.post(`/leagues/${league.id}/complete`, {});
    const ranking = payload?.ranking ?? [];
    const list = el('ol');
    for (const row of ranking) {
      list.appendChild(el('li', { text: `${row.name} — ${fa(row.total)} امتیاز (${row.title?.title ?? ''})` }));
    }
    openModal({
      title: 'رتبه‌بندی نهایی',
      body: ranking.length ? list : el('p.muted', { text: 'رتبه‌بندی خالی است.' }),
    });
    notify.ok('لیگ به پایان رسید');
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function reactivateLeague(league) {
  try {
    await api.post(`/leagues/${league.id}/reactivate`, {});
    notify.ok('لیگ دوباره فعال شد');
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function removeLeague(league) {
  const agreed = await confirmDialog({
    title: 'حذف لیگ',
    message: `لیگ «${league.name}» به همراه همه دانش‌آموزان، امتیازها و تاریخچه حذف می‌شود. ادامه می‌دهید؟`,
    confirmLabel: 'حذف لیگ',
    danger: true,
  });
  if (!agreed) return;
  try {
    await api.del(`/leagues/${league.id}`);
    if (state.leagueId === league.id) setLeagueId(null);
    notify.ok('لیگ حذف شد');
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

function leagueSwitcher(leagues, activeId) {
  const row = el('div.row');
  for (const league of leagues) {
    const isActive = league.id === activeId;
    row.appendChild(el(`button.chip.chip--button${isActive ? '.chip--ok' : ''}`, {
      type: 'button',
      title: league.name,
      text: `${isActive ? '✅' : '🏆'} ${league.name}`,
      onclick: () => {
        setLeagueId(league.id);
        void renderTeacherDashboard();
      },
    }));
  }
  row.appendChild(button('لیگ جدید', { kind: 'soft', icon: '➕', onClick: createLeague }));
  return card({ title: 'لیگ‌های من', icon: '🗂️' }, [
    leagues.length ? row : el('p.muted.small', { text: 'هنوز لیگی نساخته‌اید.' }),
  ]);
}

function managementCard(league) {
  const completed = league.status === 'completed';
  return card({ title: 'مدیریت لیگ فعال', icon: '🛠️' }, [
    el('p', {}, [
      el('strong', { text: league.name }),
      el('span.chip.chip--muted', { text: completed ? 'پایان‌یافته' : 'فعال' }),
      el('span.small.muted', { text: ` · ساخته‌شده در ${faDate(league.createdAt)}` }),
    ]),
    el('div.row', {}, [
      button('تغییر نام', { kind: 'ghost', icon: '✏️', onClick: () => renameLeague(league).then(() => renderTeacherDashboard()) }),
      completed
        ? button('فعال‌سازی دوباره', { kind: 'soft', icon: '▶️', onClick: () => reactivateLeague(league).then(() => renderTeacherDashboard()) })
        : button('پایان لیگ', { kind: 'amber', icon: '🏁', onClick: () => completeLeague(league).then(() => renderTeacherDashboard()) }),
      button('حذف لیگ', { kind: 'danger', icon: '🗑️', onClick: () => removeLeague(league).then(() => renderTeacherDashboard()) }),
    ]),
  ]);
}

function statsGrid(summary) {
  return grid('grid--stats', [
    statCard({ label: 'دانش‌آموزان', value: fa(summary.studentCount), icon: '🧑‍🎓' }),
    statCard({ label: 'حاضر امروز', value: fa(summary.presentToday), kind: 'ok', icon: '✅' }),
    statCard({ label: 'غایب امروز', value: fa(summary.absentToday), kind: 'bad', icon: '❌' }),
    statCard({ label: 'تأخیر امروز', value: fa(summary.lateToday), kind: 'warn', icon: '⏰' }),
    statCard({ label: 'میانگین امتیاز', value: fa(summary.averageScore), icon: '📊' }),
    statCard({ label: 'تیم‌ها', value: fa(summary.teamCount), icon: '🛡️' }),
    statCard({ label: 'ستون‌های امتیاز', value: fa(summary.columnCount), icon: '📋' }),
  ]);
}

export async function renderTeacherDashboard() {
  const assistant = isAssistant();
  setTopbarTitle(assistant ? 'میزکار همیار' : 'میزکار معلم');
  const body = el('div');
  const head = pageHead({
    icon: '🏫',
    title: assistant ? 'میزکار همیار' : 'میزکار معلم',
    subtitle: assistant ? 'بخش‌هایی که معلم برای شما فعال کرده است' : 'لیگ، امتیاز، تیم، حضور و ابزارهای کلاس',
    actions: assistant ? [] : [button('ساخت لیگ جدید', { icon: '➕', onClick: createLeague })],
  });
  renderView([head, body]);
  body.appendChild(loadingNode());

  let leagues = [];
  try {
    const payload = await api.get('/leagues');
    leagues = payload?.items ?? [];
  } catch (error) {
    if (error?.code === 'SUBSCRIPTION_REQUIRED') {
      window.location.hash = '#/teacher/subscription';
      return undefined;
    }
    body.textContent = '';
    body.appendChild(emptyState({ icon: '⚠️', title: 'دریافت لیست لیگ‌ها ناموفق بود', hint: errorMessage(error) }));
    return undefined;
  }

  if (leagues.length === 0) {
    setLeaguePill(null);
    body.textContent = '';
    body.appendChild(card({ title: assistant ? 'لیگ در دسترس نیست' : 'شروع کار', icon: '🚀' }, [
      emptyState({
        icon: '🏁',
        title: assistant ? 'لیگی برای این حساب همیار ثبت نشده است' : 'هنوز لیگی نساخته‌اید',
        hint: assistant
          ? 'از معلم اصلی بخواهید دسترسی لیگ را برای شما تنظیم کند.'
          : 'با ساخت نخستین لیگ، ستون‌های امتیاز پیش‌فرض و ابزارهای کلاس فعال می‌شوند.',
      }),
      assistant ? null : el('div.row', { style: { justifyContent: 'center' } }, [button('ساخت اولین لیگ', { icon: '➕', onClick: createLeague })]),
    ]));
    return undefined;
  }

  let active = leagues.find((league) => league.id === state.leagueId);
  if (!active) {
    active = leagues[0];
    setLeagueId(active.id);
  }
  setLeaguePill({ name: active.name });

  let detail = null;
  try {
    const payload = await api.get(`/leagues/${active.id}`);
    detail = payload;
  } catch (error) {
    if (error?.code === 'SUBSCRIPTION_REQUIRED') {
      window.location.hash = '#/teacher/subscription';
      return undefined;
    }
    body.textContent = '';
    body.appendChild(emptyState({ icon: '⚠️', title: 'دریافت اطلاعات لیگ ناموفق بود', hint: errorMessage(error) }));
    return undefined;
  }

  const base = `teacher/league/${active.id}`;
  const tiles = TOOLS
    .filter((tool) => !tool.perm || can(tool.perm))
    .map((tool) => tile({
      icon: tool.icon,
      label: tool.label,
      href: tool.href ?? (tool.suffix ? `${base}/${tool.suffix}` : base),
    }));

  const intro = assistant
    ? card({ title: 'دسترسی همیار', icon: '🤝' }, [
      el('p', {}, [
        el('strong', { text: state.user?.ownerDisplayName || 'معلم اصلی' }),
        el('span.small.muted', { text: ' · دسترسی شما را مدیریت می‌کند' }),
      ]),
      el('p.small.muted', { text: 'فقط بخش‌هایی که در فهرست زیر می‌بینید برای شما فعال شده‌اند.' }),
    ])
    : leagueSwitcher(leagues, active.id);

  const management = assistant ? null : managementCard({ ...active, ...detail.league });

  body.textContent = '';
  body.appendChild(el('div.grid', { style: { gap: '14px' } }, [
    intro,
    management,
    card({ title: 'خلاصه وضعیت', icon: '📈' }, [statsGrid(detail.summary)]),
    card({ title: assistant ? 'ابزارهای فعال شما' : 'ابزارهای کلاس', icon: '🧰' }, [
      tiles.length ? grid('grid--tiles', tiles) : emptyState({ icon: '🔒', title: 'هنوز بخشی برای شما فعال نشده است', hint: 'از معلم اصلی بخواهید دسترسی لازم را بدهد.' }),
    ]),
  ]));
  return undefined;
}
