/**
 * «گزارش روزانه» — condensed daily change report for parents.
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

function signed(value) {
  const number = Number(value) || 0;
  if (number === 0) return fa(0);
  return `${number > 0 ? '+' : '−'}${fa(Math.abs(number))}`;
}

function deltaKind(value) {
  if (value > 0) return 'ok';
  if (value < 0) return 'bad';
  return 'muted';
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
    setLeaguePill({ name: report.league?.name ?? '' });
    selected = new Set(
      report.items.filter((item) => item.changes > 0 && item.hasParentPhone).map((item) => item.studentId),
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
    const missing = chosen.length - withPhone;
    selectionInfo.textContent = chosen.length
      ? `${fa(chosen.length)} دانش‌آموز انتخاب شده — ${fa(withPhone)} شماره والد دارد${missing ? `، ${fa(missing)} بدون شماره` : ''}`
      : 'هیچ دانش‌آموزی انتخاب نشده است.';
    selectionInfo.className = chosen.length ? 'small' : 'small muted';
    sendButton.disabled = sending || withPhone === 0;
    sendButton.title = withPhone === 0 ? 'برای ارسال، حداقل یک دانش‌آموز با شماره والد انتخاب کنید' : 'ارسال پیامک گزارش';
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
          el('span.spacer'),
          el(`span.chip.chip--${deltaKind(item.totalDelta)}`, { text: `جمع ${signed(item.totalDelta)}` }),
        ]),
        el('pre.report-message__body', { dir: 'rtl', text: item.message }),
      ]))
      : [el('p.muted.small', { text: 'با انتخاب دانش‌آموزان، متن دقیق پیامک اینجا نمایش داده می‌شود.' })]));
    for (const row of rowsByStudent.values()) {
      const active = selected.has(row.item.studentId);
      row.node.classList.toggle('is-selected', active);
      row.checkbox.checked = active;
    }
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
        el('span.small.muted', { text: `تغییرات ثبت‌شده در ${formatJalaliDate(date)}` }),
      ]),
    ]);
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
        el('th', { scope: 'col', text: 'تغییرات امروز' }),
        el('th', { scope: 'col', text: 'جمع' }),
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
      const changesCell = el('td', {}, item.lines.length
        ? item.lines.map((line) => el(`span.chip.chip--${deltaKind(line.delta)}`, {
          text: `${line.columnName} ${signed(line.delta)}`,
        }))
        : [el('span.small.muted', { text: 'بدون تغییر' })]);
      const node = el('tr', { class: selected.has(item.studentId) ? 'is-selected' : '' }, [
        el('td', {}, [el('label.report-check', {}, [checkbox])]),
        el('td.name-cell', {}, [el('strong', { text: item.name })]),
        changesCell,
        el('td', {}, [el(`span.chip.chip--${deltaKind(item.totalDelta)}`, { text: signed(item.totalDelta) })]),
        el('td', {}, item.hasParentPhone
          ? [el('span.small', { text: item.parentPhone })]
          : [el('span.chip.chip--bad', { text: 'ثبت نشده' })]),
      ]);
      tbody.appendChild(node);
      rowsByStudent.set(item.studentId, { item, node, checkbox });
    }
    if (report.items.length === 0) {
      tbody.appendChild(el('tr', {}, [el('td', { colspan: '5' }, [el('p.muted.small', { text: 'هنوز دانش‌آموزی در این لیگ نیست.' })])]));
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
    sendButton = button('ارسال پیامک به والدین', { icon: '📤', onClick: () => { void sendSelected(); } });
    rowsByStudent.clear();

    const cards = [
      resultsCard(),
      recentCard(),
    ].filter(Boolean);

    body.replaceChildren(
      pageHead({
        icon: '📨',
        title: 'گزارش روزانه والدین',
        subtitle: 'خلاصهٔ تغییرات هر روز، برای والدین دانش‌آموزان انتخاب‌شده',
        actions: [backToWorkbench()],
      }),
      el('div.grid.grid--stats', {}, [
        statCard({ label: 'دانش‌آموزان با تغییر', value: fa(summary.changed ?? 0), icon: '📝' }),
        statCard({ label: 'بدون شماره والد', value: fa(summary.withoutParentPhone ?? 0), kind: (summary.withoutParentPhone ?? 0) ? 'warn' : 'ok', icon: '⚠️' }),
        statCard({ label: 'پیامک ارسال‌شده', value: fa(summary.sent ?? 0), kind: 'ok', icon: '✅' }),
        statCard({ label: 'در صف ارسال', value: fa(summary.queued ?? 0), icon: '📬' }),
      ]),
      dateCard(),
      smsSettings(),
      card({ title: 'انتخاب دانش‌آموزان', icon: '☑️' }, [
        el('div.row', { style: { flexWrap: 'wrap', marginBottom: '8px' } }, [
          button('فقط دارای تغییر', { kind: 'ghost', icon: '📝', onClick: () => selectWhere((item) => item.changes > 0) }),
          button('همه', { kind: 'ghost', icon: '👥', onClick: () => selectWhere(() => true) }),
          button('هیچ‌کدام', { kind: 'ghost', icon: '🚫', onClick: () => selectWhere(() => false) }),
          el('span.spacer'),
          sendButton,
        ]),
        selectionInfo,
        reportTable(),
      ]),
      customMessageCard(),
      card({ title: 'پیش‌نمایش پیامک', icon: '👁️' }, [previewHost]),
      ...cards,
    );
    refreshSelectionUi();
  }

  await load();
  return undefined;
}
