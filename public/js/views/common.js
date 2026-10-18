/** Small building blocks shared by every teacher and student view. */

import { dateOnly, dateTime, errorMessage, number } from '../format.js';
import { el } from '../dom.js';
import { state } from '../store.js';
import { emptyState, notify, statCard } from '../ui.js';

export function fa(value) {
  return number(value, state.persianDigits);
}

export function faDate(value) {
  return dateOnly(value, state.persianDigits);
}

export function faDateTime(value) {
  return dateTime(value, state.persianDigits);
}

/** Page header with an optional action row. */
export function pageHead({ icon = '', title, subtitle = '', actions = [] }) {
  const head = el('div.page-head');
  const heading = el('h1');
  heading.textContent = icon ? `${icon} ${title}` : title;
  head.appendChild(heading);
  if (subtitle) head.appendChild(el('p.muted.small', { text: subtitle }));
  head.appendChild(el('span.spacer'));
  for (const action of actions) head.appendChild(action);
  return head;
}

export function button(label, { kind = '', icon = '', onClick = null, type = 'button', title = '', disabled = false } = {}) {
  const classes = `btn${kind ? `.btn--${kind}` : ''}`;
  return el(`button.${classes}`, {
    type,
    title: title || label,
    disabled: disabled || undefined,
    onclick: onClick ?? undefined,
  }, [icon ? el('span', { text: icon, 'aria-hidden': 'true' }) : null, el('span', { text: label })]);
}

/** `size: 'sm' | 'xs'` — `xs` is used inside dense tables. */
export function iconButton(icon, { label, kind = 'ghost', onClick = null, danger = false, size = 'sm' } = {}) {
  const sizeClass = size && size !== 'sm' ? `.btn--${size}` : '.btn--sm';
  return el(`button.btn${sizeClass}.btn--${danger ? 'danger' : kind}.btn--icon`, {
    type: 'button',
    title: label,
    'aria-label': label,
    onclick: onClick ?? undefined,
  }, [el('span', { text: icon, 'aria-hidden': 'true' })]);
}

export function card({ title = '', icon = '', actions = [], className = '' }, children = []) {
  const head = title
    ? el('h2.card__title', {}, [
      icon ? el('span', { text: icon, 'aria-hidden': 'true' }) : null,
      el('span', { text: title }),
      actions.length ? el('span.spacer') : null,
      actions.length ? el('span.row', {}, actions) : null,
    ])
    : null;
  return el(`section.card${className ? `.${className}` : ''}`, {}, [head, el('div.card__body', {}, children)]);
}

export function tile({ icon, label, hint = '', onClick, href = null }) {
  const node = el(href ? 'a.tile' : 'button.tile', {
    href: href ? `#/${String(href).replace(/^#?\/?/, '')}` : undefined,
    type: href ? undefined : 'button',
    onclick: onClick ?? undefined,
  }, [
    el('span.tile__icon', { text: icon, 'aria-hidden': 'true' }),
    el('span', { text: label }),
    hint ? el('span.small.muted', { text: hint }) : null,
  ]);
  return node;
}

export function grid(className, children) {
  return el(`div.grid.${className}`, {}, children);
}

export function loadingNode(label = 'در حال بارگذاری…') {
  return el('div.empty', {}, [
    el('span.empty__icon', { text: '⏳', 'aria-hidden': 'true' }),
    el('p', { text: label }),
  ]);
}

export function errorNode(error) {
  return emptyState({ icon: '⚠️', title: 'بارگذاری داده‌ها ناموفق بود', hint: errorMessage(error) });
}

export function fail(error) {
  notify.error(errorMessage(error));
  return null;
}

export function chip(label, kind = '') {
  return el(`span.chip${kind ? `.chip--${kind}` : ''}`, { text: label });
}

export function field(label, control, hint = '') {
  return el('div.field', {}, [
    el('label', { text: label, for: control.id || undefined }),
    control,
    hint ? el('span.muted.small', { text: hint }) : null,
  ]);
}

export function spinnerRow(label = 'در حال انجام…') {
  return el('div.muted.small', { text: label });
}

/** Persian-aware, user supplied text is always written through `text`. */
export function textCell(value, className = '') {
  return el(`td${className ? `.${className}` : ''}`, { text: value ?? '' });
}

export const STATUS_LABELS = { present: 'حاضر', absent: 'غایب', late: 'تأخیر' };export const STATUS_KIND = { present: 'ok', absent: 'bad', late: 'amber' };
export const ATTENDANCE_STATUSES = ['present', 'absent', 'late'];

export function ratioChip(attended, recorded) {
  if (!recorded) return el('span.chip.chip--muted', { text: 'بدون حضور' });
  const percent = Math.round((attended / recorded) * 100);
  const kind = percent >= 90 ? 'ok' : percent >= 70 ? 'amber' : 'bad';
  return el(`span.chip.chip--${kind}`, { text: `حضور ${fa(percent)}٪` });
}

/** Reusable day/hour/minute/second countdown display. */
export function countdownBox() {
  const units = [['روز', 86400000], ['ساعت', 3600000], ['دقیقه', 60000], ['ثانیه', 1000]];
  const numbers = [];
  const row = el('div.countdown');
  for (const [label] of units) {
    const num = el('div.countdown__num', { text: fa(0) });
    numbers.push(num);
    row.appendChild(el('div.countdown__unit', {}, [num, el('div.countdown__label', { text: label })]));
  }
  function set(remainingMs) {
    let rest = Math.max(0, Number(remainingMs) || 0);
    units.forEach(([, size], index) => {
      const value = Math.floor(rest / size);
      rest -= value * size;
      numbers[index].textContent = fa(value);
    });
  }
  set(0);
  return { node: row, set };
}

/** Starts a 1s repaint loop that stops once `node` leaves the document. */
export function startCountdown(node, paint) {
  paint();
  const handle = setInterval(() => {
    if (!node.isConnected) {
      clearInterval(handle);
      return;
    }
    paint();
  }, 1000);
  return () => clearInterval(handle);
}

/** Re-exported so views only need a single import for the shared UI pieces. */
export { statCard };
