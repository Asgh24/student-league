/** Daily attendance sheet with bulk actions, ratios and league history. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { formatJalaliDate, toPersianDigits } from '../jalali.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { emptyState, formDialog, notify } from '../ui.js';
import { backToWorkbench, button, card, chip, fa, faDate, grid, loadingNode, pageHead, ratioChip, STATUS_KIND, STATUS_LABELS, statCard } from './common.js';

function shiftIso(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Last manager/vice-principal number, kept for the current page session. */
let managerPhone = '';

const SHAD_WEB_URL = 'https://web.shad.ir/';

/** Text pasted into the school manager's Shad conversation. */
export function buildManagerAbsenteesMessage({ leagueName, day, absentees }) {
  const names = absentees.map((student) => student.name).join('، ');
  return `${leagueName} | غایبین ${formatJalaliDate(day)}\nتعداد غایب: ${toPersianDigits(absentees.length)}\n${names}`;
}

/** Clipboard write with a fallback for browsers without the async API. */
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the hidden textarea fallback */
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = Boolean(document.execCommand?.('copy'));
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

async function openManagerShad({ leagueName, day, items, shadPvUrl }) {
  const absentees = items.filter((student) => student.status === 'absent');
  if (absentees.length === 0) {
    notify.error('برای این روز دانش‌آموز غایبی ثبت نشده است');
    return;
  }

  const message = buildManagerAbsenteesMessage({ leagueName, day, absentees });

  // Prefer the manager's saved private Shad link; fall back to the Shad web
  // entrance when the teacher has not saved one yet.
  const target = shadPvUrl || SHAD_WEB_URL;
  // Open during the click gesture before awaiting clipboard permission, or the
  // browser may treat the new tab as an unwanted popup.
  const tab = window.open(target, '_blank');
  if (tab) {
    try {
      tab.opener = null;
    } catch {
      /* cross-origin windows may reject the assignment */
    }
  } else {
    notify.warn('مرورگر صفحهٔ شاد را مسدود کرد؛ اجازهٔ باز شدن پنجره را بدهید و دوباره تلاش کنید');
  }
  if (!shadPvUrl) {
    notify.info('لینک PV مدیر ذخیره نشده است؛ صفحهٔ اصلی شاد باز شد. می‌توانید لینک PV را در همین صفحه وارد و ذخیره کنید');
  }

  const copied = await copyToClipboard(message);
  if (copied) {
    notify.ok(`اسامی ${fa(absentees.length)} غایب و تاریخ شمسی کپی شد؛ پیام را در شاد برای مدیر مدرسه جای‌گذاری کنید`);
  } else {
    notify.error('کپی خودکار ممکن نشد؛ اجازهٔ دسترسی به کلیپ‌بورد را فعال کنید و دوباره تلاش کنید');
  }
}

async function sendAbsenteesSms(leagueId, day, items) {
  const absentees = items.filter((student) => student.status === 'absent');
  if (absentees.length === 0) {
    notify.error('برای این روز دانش‌آموز غایبی ثبت نشده است');
    return;
  }

  const values = await formDialog({
    title: 'ارسال غایبین به مدیر',
    description: `${fa(absentees.length)} دانش‌آموز غایب در ${faDate(day)}؛ اسامی برای شماره زیر پیامک می‌شود.`,
    submitLabel: 'ارسال پیامک',
    fields: [{
      name: 'phone',
      label: 'شماره موبایل مدیر یا معاون آموزشی',
      type: 'tel',
      value: managerPhone,
      placeholder: '09121234567',
      required: true,
    }],
  });
  if (!values) return;

  managerPhone = values.phone.trim();
  try {
    const result = await api.post(`/leagues/${leagueId}/attendance/absentees/sms`, {
      date: day,
      phone: managerPhone,
    });
    if (result.status === 'sent') {
      notify.ok(`اسامی ${fa(result.absentees.length)} غایب برای مدیر پیامک شد`);
    } else if (result.status === 'queued') {
      notify.info('پیام در صف ارسال ماند؛ تنظیمات API پیامک را کامل کنید');
    } else {
      notify.error(result.error || 'ارسال پیامک غایبین ناموفق بود');
    }
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

function statusButtons(student, onSet) {
  const row = el('span.row', { style: { gap: '4px', justifyContent: 'center' } });
  for (const status of ['present', 'absent', 'late']) {
    const active = student.status === status;
    row.appendChild(el(`button.chip.chip--button${active ? `.chip--${STATUS_KIND[status]}` : ''}`, {
      type: 'button',
      text: STATUS_LABELS[status],
      'aria-pressed': active ? 'true' : 'false',
      title: `${student.name} — ${STATUS_LABELS[status]}`,
      onclick: () => onSet(student.studentId, status),
    }));
  }
  return el('td', {}, [row]);
}

function sheetTable(items, onSet) {
  const table = el('table.grid-table');
  table.appendChild(el('thead', {}, [
    el('tr', {}, [
      el('th', { text: '#' }),
      el('th', { text: 'دانش‌آموز' }),
      el('th', { text: 'نسبت حضور' }),
      el('th', { text: 'وضعیت' }),
    ]),
  ]));
  const tbody = el('tbody');
  items.forEach((student, index) => {
    tbody.appendChild(el('tr', {}, [
      el('td', { text: fa(index + 1) }),
      el('td.name-cell', {}, [
        el('strong', { text: student.name }),
        student.status ? chip(STATUS_LABELS[student.status], STATUS_KIND[student.status]) : chip('ثبت‌نشده', 'muted'),
      ]),
      el('td', {}, [ratioChip(student.attended, student.recorded)]),
      statusButtons(student, onSet),
    ]));
  });
  table.appendChild(tbody);
  return el('div.table-wrap', {}, [table]);
}

function historyCard(history) {
  if (!history.length) return card({ title: 'تاریخچه حضور', icon: '🗂️' }, [el('p.small.muted', { text: 'هنوز حضوری ثبت نشده است.' })]);
  const table = el('table.grid-table');
  table.appendChild(el('thead', {}, [
    el('tr', {}, [
      el('th', { text: 'تاریخ' }),
      el('th', { text: 'حاضر' }),
      el('th', { text: 'غایب' }),
      el('th', { text: 'تأخیر' }),
      el('th', { text: 'کل' }),
    ]),
  ]));
  const tbody = el('tbody');
  for (const row of history) {
    tbody.appendChild(el('tr', {}, [
      el('td', { text: faDate(row.day) }),
      el('td', { text: fa(row.present) }),
      el('td', { text: fa(row.absent) }),
      el('td', { text: fa(row.late) }),
      el('td', { text: fa(row.total) }),
    ]));
  }
  table.appendChild(tbody);
  return card({ title: 'تاریخچه حضور', icon: '🗂️' }, [el('div.table-wrap', {}, [table])]);
}

export async function renderAttendance({ params }) {
  const leagueId = Number(params.id);
  setLeagueId(leagueId);
  setTopbarTitle('حضور و غیاب');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let day = null;

  async function load() {
    body.replaceChildren(loadingNode());
    let league;
    let sheet;
    let history;
    try {
      const query = day ? `?date=${encodeURIComponent(day)}` : '';
      [league, sheet, history] = await Promise.all([
        api.get(`/leagues/${leagueId}`),
        api.get(`/leagues/${leagueId}/attendance${query}`),
        api.get(`/leagues/${leagueId}/attendance/history?limit=30`),
      ]);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت برگه حضور ناموفق بود', hint: errorMessage(error) }));
      return;
    }
    setLeaguePill({ name: league.league.name });
    day = sheet.date;
    let managerShadUrl = sheet.settings?.managerShadPvUrl ?? '';
    const managerShadInput = el('input', {
      type: 'url',
      id: 'manager-shad-url',
      value: managerShadUrl,
      placeholder: 'https://web.shad.ir/#/pv/...',
      maxLength: 2000,
    });

    async function saveManagerShad() {
      const raw = managerShadInput.value.trim();
      try {
        const result = await api.put(`/leagues/${leagueId}/attendance/manager-shad`, { url: raw });
        managerShadUrl = result.settings?.managerShadPvUrl ?? '';
        managerShadInput.value = managerShadUrl;
        notify.ok(managerShadUrl ? 'لینک PV مدیر ذخیره شد' : 'لینک PV مدیر پاک شد');
      } catch (error) {
        notify.error(errorMessage(error));
      }
    }

    async function setStatus(studentId, status) {
      try {
        await api.post(`/leagues/${leagueId}/attendance`, { date: day, records: [{ studentId, status }] });
        await load();
      } catch (error) {
        notify.error(errorMessage(error));
      }
    }

    async function bulk(status) {
      try {
        await api.post(`/leagues/${leagueId}/attendance/bulk`, { date: day, status });
        notify.ok('وضعیت همه دانش‌آموزان ثبت شد');
        await load();
      } catch (error) {
        notify.error(errorMessage(error));
      }
    }

    const dateInput = el('input', {
      type: 'date',
      value: day,
      id: 'attendance-date',
      onchange: (event) => {
        day = event.target.value || day;
        void load();
      },
    });

    body.replaceChildren(
      pageHead({
        icon: '🗓️',
        title: 'حضور و غیاب',
        subtitle: league.league.name,
        actions: [
          el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '↩️ لیگ' }),
          backToWorkbench(),
        ],
      }),
      grid('grid--stats', [
        statCard({ label: 'حاضر', value: fa(sheet.counters.present), kind: 'ok', icon: '✅' }),
        statCard({ label: 'غایب', value: fa(sheet.counters.absent), kind: 'bad', icon: '❌' }),
        statCard({ label: 'تأخیر', value: fa(sheet.counters.late), kind: 'warn', icon: '⏰' }),
        statCard({ label: 'ثبت‌نشده', value: fa(sheet.counters.unmarked), icon: '❔' }),
      ]),
      card({ title: `برگه ${faDate(day)}`, icon: '📋' }, [
        el('div.grid.grid--two', {}, [
          el('div.field', {}, [el('label', { for: 'attendance-date', text: 'تاریخ (میلادی، معادل شمسی نمایش داده می‌شود)' }), dateInput]),
          el('div', {}, [
            el('p.small.muted', { text: `معادل شمسی: ${faDate(day)}` }),
            el('div.row', {}, [
              button('روز قبل', { kind: 'ghost', icon: '⬅️', onClick: () => { day = shiftIso(day, -1); void load(); } }),
              button('امروز', { kind: 'ghost', icon: '📅', onClick: () => { day = sheet.today; void load(); } }),
              button('روز بعد', { kind: 'ghost', icon: '➡️', onClick: () => { day = shiftIso(day, 1); void load(); } }),
            ]),
          ]),
        ]),
        el('div.field', {}, [
          el('label', { for: 'manager-shad-url', text: 'لینک PV مدیر مدرسه در شاد (اختیاری)' }),
          el('div.row', {}, [
            managerShadInput,
            button('ذخیره لینک', { kind: 'soft', icon: '💾', onClick: () => saveManagerShad() }),
          ]),
          el('p.small.muted', { text: 'با ذخیره این لینک، دکمهٔ «ارسال به شاد مدیر مدرسه» مستقیماً گفت‌وگوی PV مدیر را باز می‌کند. هر زمان می‌توانید آن را تغییر دهید.' }),
        ]),
        el('div.row', { style: { margin: '10px 0' } }, [
          button('همه حاضر', { icon: '✅', onClick: () => bulk('present') }),
          button('همه غایب', { kind: 'danger', icon: '❌', onClick: () => bulk('absent') }),
          button('همه با تأخیر', { kind: 'amber', icon: '⏰', onClick: () => bulk('late') }),
          button('ارسال پیامکی غایبین', { kind: 'soft', icon: '📨', onClick: () => sendAbsenteesSms(leagueId, day, sheet.items) }),
          button('ارسال به شاد مدیر مدرسه', {
            kind: 'soft',
            icon: '🟢',
            onClick: () => openManagerShad({ leagueName: league.league.name, day, items: sheet.items, shadPvUrl: managerShadUrl }),
          }),
        ]),
        sheet.items.length === 0
          ? emptyState({ icon: '🧑‍🎓', title: 'دانش‌آموزی در این لیگ نیست', hint: 'ابتدا از صفحه لیگ دانش‌آموز اضافه کنید.' })
          : sheetTable(sheet.items, setStatus),
        el('p.small.muted', { style: { marginTop: '8px' }, text: 'امتیاز منفی تأخیر و غیبت، در صورت تنظیم، روی ستون انضباطی اعمال می‌شود.' }),
      ]),
      historyCard(history.items ?? []),
    );
  }

  await load();
  return undefined;
}
