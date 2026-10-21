/** Individual league page: summary, countdown timer, settings and scores. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { emptyState, notify } from '../ui.js';
import { backToWorkbench, button, card, countdownBox, fa, faDate, faDateTime, grid, loadingNode, pageHead, startCountdown, statCard } from './common.js';
import { createScoresTable } from './scoresTable.js';

function timerCard(leagueId, timer, reload) {
  const days = el('input', { id: 'timer-days', type: 'number', min: 0, max: 3650, value: 0, 'aria-label': 'روز' });
  const hours = el('input', { id: 'timer-hours', type: 'number', min: 0, max: 23, value: 0, 'aria-label': 'ساعت' });
  const minutes = el('input', { id: 'timer-minutes', type: 'number', min: 0, max: 59, value: 0, 'aria-label': 'دقیقه' });
  const seconds = el('input', { id: 'timer-seconds', type: 'number', min: 0, max: 59, value: 0, 'aria-label': 'ثانیه' });

  const display = countdownBox();
  const status = el('p.small.muted');

  const endsAt = timer?.endsAt ? new Date(timer.endsAt).getTime() : null;
  if (endsAt) {
    display.set(Math.max(0, endsAt - Date.now()));
    startCountdown(display.node, () => display.set(Math.max(0, endsAt - Date.now())));
    status.textContent = timer.expired
      ? `زمان پایان گذشته است (${faDateTime(timer.endsAt)})`
      : `پایان: ${faDateTime(timer.endsAt)}`;
  } else {
    status.textContent = 'برای این لیگ تایمری تنظیم نشده است.';
  }

  async function setTimer() {
    try {
      await api.put(`/leagues/${leagueId}/timer`, {
        days: Number(days.value) || 0,
        hours: Number(hours.value) || 0,
        minutes: Number(minutes.value) || 0,
        seconds: Number(seconds.value) || 0,
      });
      notify.ok('تایمر تنظیم شد');
      reload();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function adjust(value) {
    try {
      await api.post(`/leagues/${leagueId}/timer/adjust`, { days: value });
      notify.ok(value > 0 ? 'به زمان پایان افزوده شد' : 'یک روز کم شد');
      reload();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function resetTimer() {
    try {
      await api.del(`/leagues/${leagueId}/timer`);
      notify.ok('تایمر پاک شد');
      reload();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  const inputs = el('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))' } }, [
    el('div.field', {}, [el('label', { for: 'timer-days', text: 'روز' }), days]),
    el('div.field', {}, [el('label', { for: 'timer-hours', text: 'ساعت' }), hours]),
    el('div.field', {}, [el('label', { for: 'timer-minutes', text: 'دقیقه' }), minutes]),
    el('div.field', {}, [el('label', { for: 'timer-seconds', text: 'ثانیه' }), seconds]),
  ]);

  return card({ title: 'تایمر پایان لیگ', icon: '⏳' }, [
    display.node,
    status,
    inputs,
    el('div.row', {}, [
      button('تنظیم تایمر', { icon: '⏱️', onClick: setTimer }),
      button('+۱۰ روز', { kind: 'ghost', icon: '➕', onClick: () => adjust(10) }),
      button('−۱ روز', { kind: 'ghost', icon: '➖', onClick: () => adjust(-1) }),
      button('پاک کردن', { kind: 'danger', icon: '🗑️', onClick: resetTimer }),
    ]),
  ]);
}

function settingsCard(leagueId, settings, reload) {
  const affects = el('input', { id: 'set-affects', type: 'checkbox' });
  affects.checked = Boolean(settings.individualAffectsTeam);
  const late = el('input', { id: 'set-late', type: 'number', min: -1000, max: 0, value: settings.latePenalty ?? 0 });
  const absent = el('input', { id: 'set-absent', type: 'number', min: -1000, max: 0, value: settings.absentPenalty ?? 0 });
  const grade = el('input', { id: 'set-grade', type: 'text', maxlength: 40, value: settings.grade ?? '', placeholder: 'مثلاً ششم' });

  async function save() {
    try {
      await api.put(`/leagues/${leagueId}/settings`, {
        individualAffectsTeam: affects.checked,
        latePenalty: Number(late.value) || 0,
        absentPenalty: Number(absent.value) || 0,
        grade: grade.value.trim(),
      });
      notify.ok('تنظیمات لیگ ذخیره شد');
      reload();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  return card({ title: 'تنظیمات لیگ', icon: '🎛️' }, [
    el('label.checkbox', { for: 'set-affects' }, [affects, el('span', { text: 'امتیاز انفرادی روی امتیاز تیم اثر بگذارد' })]),
    el('p.small.muted', { text: 'در حالت فعال، امتیاز نهایی هر تیم = امتیاز مسابقات تیم + میانگین امتیاز اعضا.' }),
    el('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' } }, [
      el('div.field', {}, [
        el('label', { for: 'set-late', text: 'امتیاز منفی تأخیر' }),
        late,
        el('span.muted.small', { text: 'عدد منفی یا صفر' }),
      ]),
      el('div.field', {}, [
        el('label', { for: 'set-absent', text: 'امتیاز منفی غیبت' }),
        absent,
        el('span.muted.small', { text: 'روی ستون انضباطی اعمال می‌شود' }),
      ]),
      el('div.field', {}, [
        el('label', { for: 'set-grade', text: 'پایه تحصیلی' }),
        grade,
        el('span.muted.small', { text: 'روی کارنامه دانش‌آموزان نمایش داده می‌شود' }),
      ]),
    ]),
    el('div.row', {}, [button('ذخیره تنظیمات', { kind: 'soft', icon: '💾', onClick: save })]),
  ]);
}

function rankingCard(league) {
  const rows = league.finalRanking ?? [];
  if (league.status !== 'completed') {
    return card({ title: 'رتبه‌بندی نهایی', icon: '🏁' }, [
      el('p.small.muted', { text: 'پس از پایان لیگ، رتبه‌بندی نهایی و مدال‌ها اینجا ثبت می‌شوند.' }),
    ]);
  }
  if (rows.length === 0) {
    return card({ title: 'رتبه‌بندی نهایی', icon: '🏁' }, [el('p.small.muted', { text: 'رتبه‌بندی نهایی خالی است.' })]);
  }
  const table = el('table.grid-table');
  const tbody = el('tbody');
  for (const row of rows) {
    tbody.appendChild(el('tr', {}, [
      el('td', { text: fa(row.rank) }),
      el('td.name-cell', { text: row.name }),
      el('td.total-cell', { text: fa(row.total) }),
    ]));
  }
  table.appendChild(tbody);
  return card({ title: 'رتبه‌بندی نهایی', icon: '🏁' }, [el('div.table-wrap', {}, [table])]);
}

export async function renderLeague({ params }) {
  const leagueId = Number(params.id);
  setTopbarTitle('لیگ انفرادی');
  setLeagueId(leagueId);
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  async function load() {
    body.replaceChildren(loadingNode());
    let detail;
    let scores;
    try {
      [detail, scores] = await Promise.all([
        api.get(`/leagues/${leagueId}`),
        api.get(`/leagues/${leagueId}/scores`),
      ]);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت اطلاعات لیگ ناموفق بود', hint: errorMessage(error) }));
      return;
    }

    const { league, summary, settings, timer } = detail;
    setLeaguePill({ name: league.name });
    const columns = scores.columns ?? [];
    const students = scores.students ?? [];

    body.replaceChildren(
      pageHead({
        icon: '🏆',
        title: league.name,
        subtitle: league.status === 'completed' ? `پایان‌یافته در ${faDate(league.completedAt)}` : 'لیگ فعال',
        actions: [backToWorkbench()],
      }),
      grid('grid--stats', [
        statCard({ label: 'دانش‌آموزان', value: fa(summary.studentCount), icon: '🧑‍🎓' }),
        statCard({ label: 'میانگین امتیاز', value: fa(summary.averageScore), icon: '📊' }),
        statCard({ label: 'حاضر امروز', value: fa(summary.presentToday), kind: 'ok', icon: '✅' }),
        statCard({ label: 'غایب امروز', value: fa(summary.absentToday), kind: 'bad', icon: '❌' }),
        statCard({ label: 'تأخیر امروز', value: fa(summary.lateToday), kind: 'warn', icon: '⏰' }),
        statCard({ label: 'بدون ثبت امروز', value: fa(summary.unmarkedToday), icon: '❔' }),
      ]),
      grid('grid--two', [
        timerCard(leagueId, timer, load),
        settingsCard(leagueId, settings, load),
      ]),
      rankingCard(league),
      card({ title: 'جدول امتیازها', icon: '📋' }, [
        createScoresTable({ leagueId, columns, students, reload: load }),
      ]),
    );
  }

  await load();
  return undefined;
}
