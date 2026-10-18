/** Teacher workspace: league switching, summary cards and the 11 tool tiles. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId, state } from '../store.js';
import { confirmDialog, emptyState, formDialog, notify, openModal } from '../ui.js';
import { button, card, fa, faDate, grid, loadingNode, pageHead, statCard, tile } from './common.js';

const TOOLS = [
  { suffix: '', icon: '🏆', label: 'لیگ انفرادی' },
  { suffix: 'teams', icon: '🛡️', label: 'لیگ تیمی' },
  { suffix: 'attendance', icon: '🗓️', label: 'حضور و غیاب' },
  { suffix: 'evaluations', icon: '📝', label: 'ارزشیابی دروس' },
  { suffix: 'raffle', icon: '🎲', label: 'قرعه‌کشی' },
  { suffix: 'live', icon: '📺', label: 'تابلوی زنده' },
  { suffix: 'timer', icon: '⏱️', label: 'تایمر و ابزار' },
  { suffix: 'wheel', icon: '🎡', label: 'گردونه شانس' },
  { suffix: 'qa', icon: '❓', label: 'سوال و پاسخ' },
  { suffix: 'homework', icon: '📚', label: 'تکالیف' },
  { suffix: 'schedule', icon: '🗂️', label: 'برنامه هفتگی' },
  { suffix: 'files', icon: '📎', label: 'ارسال فایل' },
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
  setTopbarTitle('میزکار معلم');
  const body = el('div');
  const head = pageHead({
    icon: '🏫',
    title: 'میزکار معلم',
    subtitle: 'لیگ، امتیاز، تیم، حضور و ابزارهای کلاس',
    actions: [button('ساخت لیگ جدید', { icon: '➕', onClick: createLeague })],
  });
  renderView([head, body]);
  body.appendChild(loadingNode());

  let leagues = [];
  try {
    const payload = await api.get('/leagues');
    leagues = payload?.items ?? [];
  } catch (error) {
    body.textContent = '';
    body.appendChild(emptyState({ icon: '⚠️', title: 'دریافت لیست لیگ‌ها ناموفق بود', hint: errorMessage(error) }));
    return undefined;
  }

  if (leagues.length === 0) {
    setLeaguePill(null);
    body.textContent = '';
    body.appendChild(card({ title: 'شروع کار', icon: '🚀' }, [
      emptyState({
        icon: '🏁',
        title: 'هنوز لیگی نساخته‌اید',
        hint: 'با ساخت نخستین لیگ، ستون‌های امتیاز پیش‌فرض و ابزارهای کلاس فعال می‌شوند.',
      }),
      el('div.row', { style: { justifyContent: 'center' } }, [button('ساخت اولین لیگ', { icon: '➕', onClick: createLeague })]),
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
    body.textContent = '';
    body.appendChild(emptyState({ icon: '⚠️', title: 'دریافت اطلاعات لیگ ناموفق بود', hint: errorMessage(error) }));
    return undefined;
  }

  const base = `teacher/league/${active.id}`;
  const tiles = TOOLS.map((tool) => tile({
    icon: tool.icon,
    label: tool.label,
    href: tool.suffix ? `${base}/${tool.suffix}` : base,
  }));

  body.textContent = '';
  body.appendChild(el('div.grid', { style: { gap: '14px' } }, [
    leagueSwitcher(leagues, active.id),
    managementCard({ ...active, ...detail.league }),
    card({ title: 'خلاصه وضعیت', icon: '📈' }, [statsGrid(detail.summary)]),
    card({ title: 'ابزارهای کلاس', icon: '🧰' }, [grid('grid--tiles', tiles)]),
  ]));
  return undefined;
}
