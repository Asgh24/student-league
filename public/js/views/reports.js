/**
 * «گزارش روزانه» — condensed daily status report for parents. It never prints
 * points; only the status of attendance, discipline, evaluations and homework.
 *
 * The teacher picks a Shamsi day, selects the students (students with a change
 * and a parent number are selected by default), reviews the exact message and
 * sends it through sms.ir. Without provider credentials the message is stored
 * in the local outbox and the UI says so.
 */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { formatJalaliDate, todayIso } from '../jalali.js';
import { jalaliDateInput } from '../jalaliDate.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { confirmDialog, emptyState, notify } from '../ui.js';
import { backToWorkbench, button, card, chip, fa, faDateTime, loadingNode, pageHead, statCard } from './common.js';
import { smsSettingsCard } from './smsSettings.js';

const STATUS_LABELS = {
  sent: { label: 'ارسال شد', kind: 'ok' },
  queued: { label: 'در صف', kind: 'amber' },
  failed: { label: 'ناموفق', kind: 'bad' },
  skipped: { label: 'بدون شماره', kind: 'muted' },
};

const EVALUATION_STATUS = {
  up: { label: 'بهبود', kind: 'ok' },
  down: { label: 'کاهش', kind: 'bad' },
  flat: { label: 'بدون تغییر', kind: 'muted' },
};

const ATTENDANCE_STATUS = {
  present: { label: 'حاضر', kind: 'ok' },
  absent: { label: 'غایب', kind: 'bad' },
  late: { label: 'تأخیر', kind: 'amber' },
};

const DISCIPLINE_STATUS = {
  orderly: { label: 'منظم', kind: 'ok' },
  disorderly: { label: 'بی‌نظمی', kind: 'bad' },
};

const HOMEWORK_STATUS = {
  done: { label: 'انجام شد', kind: 'ok' },
  not_done: { label: 'انجام نشد', kind: 'muted' },
  incomplete: { label: 'ناقص', kind: 'amber' },
  absent: { label: 'غایب', kind: 'bad' },
  not_brought: { label: 'نیاورده', kind: 'bad' },
};

/** Status-only view of a report line; older payloads only carry `delta`. */
function evaluationStatusOf(line) {
  if (line?.status && EVALUATION_STATUS[line.status]) return line.status;
  const delta = Number(line?.delta) || 0;
  return delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
}

function statusChip(meta, fallback = 'ثبت‌نشده') {
  return meta ? chip(meta.label, meta.kind) : chip(fallback, 'muted');
}

/** Clipboard write with a selection fallback for older browsers. */
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea fallback */
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

export async function renderReports({ params }) {
  const leagueId = Number(params.id);
  setTopbarTitle('گزارش روزانه والدین');
  setLeagueId(leagueId);

  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let report = null;
  let date = todayIso();
  let selected = new Set();
  let lastResult = null;
  let sending = false;
  let savingChannels = false;
  let channels = { sms: true, shad: true };

  /** True when at least one enabled channel can reach this student. */
  function reachable(item) {
    return (channels.sms && item.hasParentPhone) || (channels.shad && item.hasShadPvUrl);
  }

  async function load() {
    body.replaceChildren(loadingNode());
    try {
      report = await api.get(`/leagues/${leagueId}/reports/daily?date=${encodeURIComponent(date)}`);
    } catch (error) {
      body.replaceChildren(
        pageHead({ icon: '📨', title: 'گزارش روزانه والدین', actions: [backToWorkbench()] }),
        emptyState({ icon: '⚠️', title: 'دریافت گزارش ناموفق بود', hint: errorMessage(error) }),
      );
      return;
    }
    date = report.date;
    channels = report.channels ?? { sms: true, shad: true };
    setLeaguePill({ name: report.league?.name ?? '' });
    selected = new Set(
      report.items.filter((item) => item.changes > 0 && reachable(item)).map((item) => item.studentId),
    );
    paint();
  }

  function itemsForDisplay() {
    return [...report.items].sort((a, b) => {
      if (b.changes !== a.changes) return b.changes - a.changes;
      return a.studentId - b.studentId;
    });
  }

  function selectedItems() {
    return report.items.filter((item) => selected.has(item.studentId));
  }

  function refreshSelectionUi() {
    const chosen = selectedItems();
    const withPhone = chosen.filter((item) => item.hasParentPhone).length;
    const withShad = chosen.filter((item) => item.hasShadPvUrl).length;
    const reach = [];
    if (channels.sms) reach.push(`${fa(withPhone)} شماره والد`);
    if (channels.shad) reach.push(`${fa(withShad)} لینک شاد`);
    const missing = [];
    if (channels.sms && withPhone < chosen.length) missing.push(`${fa(chosen.length - withPhone)} بدون شماره`);
    if (channels.shad && withShad < chosen.length) missing.push(`${fa(chosen.length - withShad)} بدون لینک شاد`);
    const noChannels = !channels.sms && !channels.shad;
    selectionInfo.textContent = noChannels
      ? 'هیچ کانال ارسالی فعال نیست؛ ابتدا پیامک یا شاد را فعال کنید.'
      : chosen.length
        ? `${fa(chosen.length)} دانش‌آموز انتخاب شده — ${reach.join('، ')}${missing.length ? `، ${missing.join('، ')}` : ''}`
        : 'هیچ دانش‌آموزی انتخاب نشده است.';
    selectionInfo.className = chosen.length && !noChannels ? 'small' : 'small muted';
    if (sendButton) {
      sendButton.disabled = sending || withPhone === 0;
      sendButton.title = withPhone === 0 ? 'برای ارسال، حداقل یک دانش‌آموز با شماره والد انتخاب کنید' : 'ارسال پیامک گزارش';
    }
    if (customSendButton) {
      const hasText = customMessage.value.trim().length > 0;
      customSendButton.disabled = sending || withPhone === 0 || !hasText;
      customSendButton.title = withPhone === 0
        ? 'برای ارسال، حداقل یک دانش‌آموز با شماره والد انتخاب کنید'
        : hasText
          ? 'ارسال پیام دلخواه به والدین'
          : 'متن پیام را وارد کنید';
    }
    previewHost.replaceChildren(...(chosen.length
      ? chosen.map((item) => el('div.report-message', {}, [
        el('div.report-message__head', {}, [
          el('strong', { text: item.name }),
          item.hasParentPhone
            ? chip(item.parentPhone, 'muted')
            : chip('شماره والد ثبت نشده', 'bad'),
          channels.shad
            ? (item.hasShadPvUrl ? chip('شاد ✓', 'ok') : chip('لینک شاد ثبت نشده', 'bad'))
            : null,
          el('span.spacer'),
          chip(`${fa(item.changes)} تغییر ثبت‌شده`, 'muted'),
        ]),
        el('pre.report-message__body', { dir: 'rtl', text: item.message }),
        el('div.row.report-message__actions', { style: { marginTop: '6px', flexWrap: 'wrap' } }, [
          button('کپی متن', { kind: 'ghost', icon: '📋', onClick: () => { void copyReportText(item); } }),
          channels.shad
            ? button(item.hasShadPvUrl ? 'ارسال با شاد' : 'لینک شاد ثبت نشده', {
              kind: 'soft',
              icon: '🟢',
              disabled: !item.hasShadPvUrl,
              onClick: () => { void openShad(item); },
            })
            : null,
        ]),
      ]))
      : [el('p.muted.small', { text: 'با انتخاب دانش‌آموزان، متن دقیق پیامک اینجا نمایش داده می‌شود.' })]));
    for (const row of rowsByStudent.values()) {
      const active = selected.has(row.item.studentId);
      row.node.classList.toggle('is-selected', active);
      row.checkbox.checked = active;
    }
  }

  async function copyReportText(item) {
    const copied = await copyToClipboard(item.message);
    if (copied) notify.ok(`متن گزارش ${item.name} کپی شد`);
    else notify.error('کپی خودکار ممکن نشد؛ متن را از کادر پیش‌نمایش انتخاب و کپی کنید');
  }

  /** Opens the parent's Shad PV link and copies that student's exact message. */
  async function openShad(item) {
    if (!channels.shad) {
      notify.error('ارسال با شاد در تنظیمات گزارش روزانه غیرفعال است');
      return;
    }
    if (!item.hasShadPvUrl || !item.shadPvUrl) {
      notify.error(`برای ${item.name} لینک شاد ثبت نشده است`);
      return;
    }

    // Open first, while the click still counts as a user gesture; copy next so
    // the teacher can immediately paste the message in the Shad app.
    const tab = window.open(item.shadPvUrl, '_blank');
    if (tab) {
      try {
        tab.opener = null;
      } catch {
        /* cross-origin windows may reject the assignment */
      }
    } else {
      notify.warn('مرورگر پنجرهٔ شاد را مسدود کرد؛ اجازهٔ باز شدن پنجره را بدهید و دوباره تلاش کنید');
    }

    const copied = await copyToClipboard(item.message);
    if (copied) notify.ok(`لینک شاد ${item.name} باز شد و متن گزارش کپی شد`);
    else notify.info(`لینک شاد ${item.name} باز شد؛ متن را از پیش‌نمایش کپی کنید`);
  }

  const selectionInfo = el('p.small.muted');
  const previewHost = el('div.report-previews');
  const rowsByStudent = new Map();
  const customMessage = el('textarea', {
    id: 'custom-sms-message',
    rows: '4',
    maxlength: '1000',
    dir: 'rtl',
    placeholder: 'مثلاً: سلام، احتراماً به اطلاع می‌رسانم آرش امروز در کلاس ... لطفاً در خانه پیگیری کنید.',
    'aria-label': 'متن پیام دلخواه برای والدین',
  });
  customMessage.addEventListener('input', refreshSelectionUi);
  let sendButton = null;
  let customSendButton = null;

  function toggle(studentId, value) {
    if (value) selected.add(studentId);
    else selected.delete(studentId);
    refreshSelectionUi();
  }

  function selectWhere(predicate) {
    selected = new Set(report.items.filter(predicate).map((item) => item.studentId));
    refreshSelectionUi();
  }

  function dateCard() {
    const field = jalaliDateInput({
      id: 'report-date',
      value: date,
      onChange: (iso) => {
        if (!iso || iso === date) return;
        date = iso;
        lastResult = null;
        void load();
      },
    });
    return card({ title: 'روز گزارش', icon: '📅' }, [
      el('div.row', { style: { flexWrap: 'wrap', alignItems: 'flex-end' } }, [
        el('div.field', { style: { minWidth: '220px' } }, [el('label', { for: 'report-date', text: 'تاریخ (شمسی)' }), field]),
        button('امروز', { kind: 'ghost', icon: '📆', onClick: () => { date = todayIso(); void load(); } }),
        el('span.small.muted', { text: `وضعیت ثبت‌شده در ${formatJalaliDate(date)}` }),
      ]),
    ]);
  }

  function channelsCard() {
    const smsBox = el('input', {
      id: 'report-channel-sms',
      type: 'checkbox',
      checked: channels.sms,
      disabled: savingChannels,
      onchange: () => { void saveChannels({ ...channels, sms: smsBox.checked }); },
    });
    const shadBox = el('input', {
      id: 'report-channel-shad',
      type: 'checkbox',
      checked: channels.shad,
      disabled: savingChannels,
      onchange: () => { void saveChannels({ ...channels, shad: shadBox.checked }); },
    });
    return card({ title: 'کانال‌های ارسال گزارش', icon: '🔀' }, [
      el('p.small.muted', {
        text: 'این دو گزینه برای همهٔ لیگ‌های شما ذخیره می‌شوند؛ هر کدام را خواستید خاموش کنید.',
      }),
      el('div.row', { style: { flexWrap: 'wrap', gap: '18px', margin: '6px 0' } }, [
        el('label.row', { style: { gap: '6px', alignItems: 'center' } }, [
          smsBox,
          el('span', { text: '📱 ارسال با پیامک (sms.ir)' }),
        ]),
        el('label.row', { style: { gap: '6px', alignItems: 'center' } }, [
          shadBox,
          el('span', { text: '🟢 ارسال با شاد (باز کردن لینک و کپی متن)' }),
        ]),
      ]),
      channels.sms || channels.shad
        ? null
        : chip('هیچ کانالی فعال نیست؛ ارسال گزارش ممکن نیست', 'bad'),
      el('p.small.muted', {
        text: 'در روش شاد، لینک PV هر والد را در بخش «شماره‌ها» ثبت کنید. هنگام زدن دکمهٔ شاد، لینک در تب جدید باز می‌شود و متن همان دانش‌آموز در کلیپ‌بورد کپی می‌شود تا در برنامهٔ شاد بچسبانید.',
      }),
      el('div.row', { style: { flexWrap: 'wrap' } }, [
        el('a.btn.btn--ghost', {
          href: `#/teacher/league/${leagueId}/contacts`,
          text: '📱 ثبت لینک‌های شاد در شماره‌ها',
        }),
      ]),
    ]);
  }

  async function saveChannels(next) {
    if (savingChannels) return;
    const previous = channels;
    savingChannels = true;
    channels = next;
    try {
      const result = await api.put(`/leagues/${leagueId}/reports/channels`, next);
      channels = result.channels ?? next;
      report.channels = channels;
      notify.ok('کانال‌های ارسال ذخیره شد');
    } catch (error) {
      channels = previous;
      notify.error(errorMessage(error));
    } finally {
      savingChannels = false;
      paint();
    }
  }

  function smsSettings() {
    return smsSettingsCard({
      config: report.sms ?? {},
      sampleMessage: report.sampleMessage ?? '',
      onSaved: (config) => {
        report.sms = config;
        paint();
      },
    });
  }

  function reportTable() {
    const table = el('table.grid-table.report-table');
    table.appendChild(el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'انتخاب' }),
        el('th', { scope: 'col', text: 'دانش‌آموز' }),
        el('th', { scope: 'col', text: 'وضعیت حضور' }),
        el('th', { scope: 'col', text: 'انضباط' }),
        el('th', { scope: 'col', text: 'ارزشیابی' }),
        el('th', { scope: 'col', text: 'تکالیف' }),
        el('th', { scope: 'col', text: 'شماره والد' }),
      ]),
    ]));
    const tbody = el('tbody');
    for (const item of itemsForDisplay()) {
      const checkbox = el('input', {
        type: 'checkbox',
        checked: selected.has(item.studentId),
        'aria-label': `انتخاب ${item.name}`,
        onchange: () => toggle(item.studentId, checkbox.checked),
      });
      const evaluationCell = el('td', {}, item.lines?.length
        ? item.lines.map((line) => {
          const meta = EVALUATION_STATUS[evaluationStatusOf(line)];
          return chip(`${line.columnName}: ${meta.label}`, meta.kind);
        })
        : [el('span.small.muted', { text: 'بدون تغییر' })]);
      const homeworkCell = el('td', {}, item.homework?.length
        ? item.homework.map((homework) => {
          const meta = HOMEWORK_STATUS[homework.status] ?? { label: homework.status, kind: 'muted' };
          return chip(`${homework.title}: ${meta.label}`, meta.kind);
        })
        : [el('span.small.muted', { text: 'بدون تکلیف' })]);
      const node = el('tr', { class: selected.has(item.studentId) ? 'is-selected' : '' }, [
        el('td', {}, [el('label.report-check', {}, [checkbox])]),
        el('td.name-cell', {}, [
          el('strong', { text: item.name }),
          channels.shad
            ? (item.hasShadPvUrl ? chip('شاد ✓', 'ok') : chip('شاد ثبت نشده', 'bad'))
            : null,
        ]),
        el('td', {}, [statusChip(ATTENDANCE_STATUS[item.attendanceStatus])]),
        el('td', {}, [statusChip(DISCIPLINE_STATUS[item.discipline?.status])]),
        evaluationCell,
        homeworkCell,
        el('td', {}, item.hasParentPhone
          ? [el('span.small', { text: item.parentPhone })]
          : [el('span.chip.chip--bad', { text: 'ثبت نشده' })]),
      ]);
      tbody.appendChild(node);
      rowsByStudent.set(item.studentId, { item, node, checkbox });
    }
    if (report.items.length === 0) {
      tbody.appendChild(el('tr', {}, [el('td', { colspan: '7' }, [el('p.muted.small', { text: 'هنوز دانش‌آموزی در این لیگ نیست.' })])]));
    }
    table.appendChild(tbody);
    return el('div.table-wrap', {}, [table]);
  }

  function resultsCard() {
    if (!lastResult) return null;
    const counts = lastResult.counts ?? {};
    return card({ title: 'نتیجهٔ ارسال', icon: '📬' }, [
      el('div.row', { style: { flexWrap: 'wrap' } }, [
        chip(`ارسال‌شده ${fa(counts.sent ?? 0)}`, 'ok'),
        chip(`در صف ${fa(counts.queued ?? 0)}`, 'amber'),
        chip(`ناموفق ${fa(counts.failed ?? 0)}`, 'bad'),
        chip(`بدون شماره ${fa(counts.skipped ?? 0)}`, 'muted'),
      ]),
      el('div.table-wrap', { style: { marginTop: '10px' } }, [
        el('table.grid-table', {}, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'دانش‌آموز' }),
            el('th', { text: 'وضعیت' }),
            el('th', { text: 'توضیح' }),
          ])]),
          el('tbody', {}, (lastResult.results ?? []).map((result) => {
            const meta = STATUS_LABELS[result.status] ?? { label: result.status, kind: 'muted' };
            return el('tr', {}, [
              el('td', { text: result.name }),
              el('td', {}, [chip(meta.label, meta.kind)]),
              el('td.small', { text: result.status === 'skipped' ? 'شماره والد ثبت نشده است.' : result.error ?? '' }),
            ]);
          })),
        ]),
      ]),
    ]);
  }

  function recentCard() {
    if (!report.recent?.length) {
      return card({ title: 'ارسال‌های اخیر این روز', icon: '🕘' }, [el('p.muted.small', { text: 'برای این روز هنوز پیامکی ثبت نشده است.' })]);
    }
    const list = el('div.report-recent');
    for (const message of report.recent) {
      const meta = STATUS_LABELS[message.status] ?? { label: message.status, kind: 'muted' };
      list.appendChild(el('div.report-recent__item', {}, [
        el('div.row', { style: { flexWrap: 'wrap' } }, [
          el('strong', { text: message.studentName || '—' }),
          el('span.small.muted', { text: message.mobile }),
          chip(meta.label, meta.kind),
          el('span.spacer'),
          el('span.small.muted', { text: faDateTime(message.createdAt) }),
        ]),
        el('pre.report-message__body', { dir: 'rtl', text: message.body }),
        message.error ? el('p.small', { style: { color: '#b91c1c' }, text: message.error }) : null,
      ]));
    }
    return card({ title: 'ارسال‌های اخیر این روز', icon: '🕘' }, [list]);
  }

  async function sendCustomMessage() {
    if (!channels.sms) {
      notify.error('ارسال پیامکی در تنظیمات گزارش روزانه غیرفعال است');
      return;
    }
    const chosen = selectedItems();
    const withPhone = chosen.filter((item) => item.hasParentPhone);
    const text = customMessage.value.trim();
    if (sending) return;
    if (!text) {
      notify.error('متن پیام را وارد کنید');
      customMessage.focus();
      return;
    }
    if (withPhone.length === 0) {
      notify.error('برای ارسال، حداقل یک دانش‌آموز با شماره والد انتخاب کنید');
      return;
    }

    const agreed = await confirmDialog({
      title: 'ارسال پیام دلخواه',
      message: `این پیام برای والدین ${fa(withPhone.length)} دانش‌آموز انتخاب‌شده ارسال شود؟`,
      confirmLabel: 'ارسال پیام',
    });
    if (!agreed) return;

    sending = true;
    if (customSendButton) customSendButton.disabled = true;
    try {
      const result = await api.post(`/leagues/${leagueId}/reports/custom/send`, {
        studentIds: chosen.map((item) => item.studentId),
        message: text,
      });
      lastResult = result;
      customMessage.value = '';
      const counts = result.counts ?? {};
      if (counts.sent) notify.ok(`${fa(counts.sent)} پیام ارسال شد`);
      if (counts.queued) notify.info(`${fa(counts.queued)} پیام در صف ذخیره شد (کلید و خط sms.ir را در تنظیمات پیامک کامل کنید)`);
      if (counts.failed) notify.error(`${fa(counts.failed)} پیام ناموفق بود`);
      if (counts.skipped) notify.warn(`${fa(counts.skipped)} دانش‌آموز شماره والد ندارد`);
      await load();
    } catch (error) {
      notify.error(errorMessage(error));
    } finally {
      sending = false;
      refreshSelectionUi();
    }
  }

  async function sendSelected() {
    if (!channels.sms) {
      notify.error('ارسال پیامکی در تنظیمات گزارش روزانه غیرفعال است');
      return;
    }
    const chosen = selectedItems();
    const withPhone = chosen.filter((item) => item.hasParentPhone);
    if (withPhone.length === 0 || sending) return;
    const agreed = await confirmDialog({
      title: 'ارسال گزارش روزانه',
      message: `پیامک تغییرات ${formatJalaliDate(date)} برای ${fa(withPhone.length)} دانش‌آموز به شماره والدین ارسال شود؟`,
      confirmLabel: 'ارسال پیامک',
    });
    if (!agreed) return;
    sending = true;
    if (sendButton) sendButton.disabled = true;
    try {
      lastResult = await api.post(`/leagues/${leagueId}/reports/daily/send`, {
        date,
        // Students without a parent number are sent too, so the server reports
        // them as «skipped» instead of silently dropping the selection.
        studentIds: chosen.map((item) => item.studentId),
      });
      report = lastResult;
      channels = report.channels ?? channels;
      const counts = lastResult.counts ?? {};
      if (counts.sent) notify.ok(`${fa(counts.sent)} پیامک ارسال شد`);
      if (counts.queued) notify.info(`${fa(counts.queued)} پیامک در صف ذخیره شد (کلید و خط sms.ir را در تنظیمات پیامک کامل کنید)`);
      if (counts.failed) notify.error(`${fa(counts.failed)} پیامک ناموفق بود`);
      if (counts.skipped) notify.warn(`${fa(counts.skipped)} دانش‌آموز شماره والد ندارد`);
      paint();
    } catch (error) {
      notify.error(errorMessage(error));
    } finally {
      sending = false;
      if (sendButton) sendButton.disabled = false;
    }
  }

  function customMessageCard() {
    customSendButton = button('ارسال پیام به والدین', { icon: '✍️', onClick: () => { void sendCustomMessage(); } });
    return card({ title: 'پیام دلخواه به والدین', icon: '✍️' }, [
      el('p.small.muted', {
        text: 'متن دلخواه خود را بنویسید؛ برای والدین دانش‌آموزان انتخاب‌شده ارسال می‌شود. برای یک دانش‌آموز، فقط همان را انتخاب کنید.',
      }),
      customMessage,
      el('div.row', { style: { marginTop: '8px', flexWrap: 'wrap' } }, [
        el('span.small.muted', { text: 'حداکثر ۱۰۰۰ نویسه · ارسال از همان حساب پیامک صفحهٔ بالا' }),
        el('span.spacer'),
        customSendButton,
      ]),
    ]);
  }

  function paint() {
    const summary = report.summary ?? {};
    sendButton = channels.sms ? button('ارسال پیامک به والدین', { icon: '📤', onClick: () => { void sendSelected(); } }) : null;
    customSendButton = null;
    rowsByStudent.clear();

    const stats = [
      statCard({ label: 'دانش‌آموزان با تغییر', value: fa(summary.changed ?? 0), icon: '📝' }),
      channels.sms
        ? statCard({ label: 'بدون شماره والد', value: fa(summary.withoutParentPhone ?? 0), kind: (summary.withoutParentPhone ?? 0) ? 'warn' : 'ok', icon: '⚠️' })
        : null,
      channels.shad
        ? statCard({ label: 'بدون لینک شاد', value: fa(summary.withoutShadUrl ?? 0), kind: (summary.withoutShadUrl ?? 0) ? 'warn' : 'ok', icon: '🟢' })
        : null,
      channels.shad
        ? statCard({ label: 'لینک شاد ثبت‌شده', value: fa(summary.shadReady ?? 0), kind: 'ok', icon: '🔗' })
        : null,
      channels.sms
        ? statCard({ label: 'پیامک ارسال‌شده', value: fa(summary.sent ?? 0), kind: 'ok', icon: '✅' })
        : null,
      channels.sms
        ? statCard({ label: 'در صف ارسال', value: fa(summary.queued ?? 0), icon: '📬' })
        : null,
    ].filter(Boolean);

    const cards = [
      channels.sms ? resultsCard() : null,
      channels.sms ? recentCard() : null,
    ].filter(Boolean);

    body.replaceChildren(
      pageHead({
        icon: '📨',
        title: 'گزارش روزانه والدین',
        subtitle: 'خلاصهٔ وضعیت روزانهٔ هر دانش‌آموز، بدون درج امتیاز؛ تحویل با پیامک یا شاد',
        actions: [backToWorkbench()],
      }),
      el('div.grid.grid--stats', {}, stats),
      dateCard(),
      channelsCard(),
      channels.sms ? smsSettings() : null,
      card({ title: 'انتخاب دانش‌آموزان', icon: '☑️' }, [
        el('div.row', { style: { flexWrap: 'wrap', marginBottom: '8px' } }, [
          button('فقط دارای تغییر', { kind: 'ghost', icon: '📝', onClick: () => selectWhere((item) => item.changes > 0) }),
          button('همه', { kind: 'ghost', icon: '👥', onClick: () => selectWhere(() => true) }),
          button('هیچ‌کدام', { kind: 'ghost', icon: '🚫', onClick: () => selectWhere(() => false) }),
          el('span.spacer'),
          sendButton,
          !channels.sms && channels.shad
            ? el('span.small.muted', { text: 'برای شاد، از دکمهٔ هر دانش‌آموز در پیش‌نمایش استفاده کنید.' })
            : null,
        ]),
        selectionInfo,
        reportTable(),
      ]),
      channels.sms ? customMessageCard() : null,
      card({ title: 'پیش‌نمایش پیام', icon: '👁️' }, [previewHost]),
      ...cards,
    );
    refreshSelectionUi();
  }

  await load();
  return undefined;
}

/**
 * «کارنامه دانش‌آموزان» — the manual report-card screen is still under
 * construction. Keeping a valid placeholder here lets the router import it
 * without breaking every other view (a bad module import blanks the whole app).
 */
export async function renderReportCards() {
  setTopbarTitle('کارنامه دانش‌آموزان');
  renderView([
    pageHead({
      icon: '📊',
      title: 'کارنامه دانش‌آموزان',
      subtitle: 'ثبت دستی نمرات توصیفی و کمی برای دانش‌آموزان',
      actions: [backToWorkbench()],
    }),
    emptyState({
      icon: '🔨',
      title: 'در حال توسعه است',
      hint: 'این بخش در حال پیاده‌سازی کامل است. لطفاً بعداً مراجعه کنید.',
    }),
  ]);
}
