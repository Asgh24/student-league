/**
 * Jalali (Shamsi) date field. Three native selects — year, month and day, in
 * Persian reading order — wrapped in one node whose `value` property is the
 * ISO `YYYY-MM-DD` string the API expects. That makes it a drop-in replacement
 * for `<input type="date">`: `value` can be read and assigned exactly like a
 * native input, while the teacher picks a Shamsi date.
 *
 * `allowEmpty` adds a «—» option to every select so a filter can stay open on
 * one side; `value` is then `''` until all three parts are picked.
 */

import { el } from './dom.js';
import {
  JALALI_MONTHS,
  isoToJalali,
  jalaliMonthLength,
  jalaliToIso,
  todayIso,
  toPersianDigits,
} from './jalali.js';

const YEARS_BEFORE = 5;
const YEARS_AFTER = 1;
const EMPTY_LABEL = '—';

function label(value, persianDigits) {
  return persianDigits ? toPersianDigits(value) : String(value);
}

/**
 * @param {object} [options]
 * @param {string} [options.id]          id of the wrapper (so `label[for]` and `#id` keep working)
 * @param {string} [options.value]       ISO `YYYY-MM-DD`; defaults to today
 * @param {boolean} [options.allowEmpty] allow an empty value (filters)
 * @param {boolean} [options.persianDigits]
 * @param {number} [options.tzOffsetMinutes] timezone used to resolve “today”
 * @param {string} [options.ariaLabel]
 * @param {(iso: string) => void} [options.onChange]
 */
export function jalaliDateInput({
  id = '',
  value = '',
  allowEmpty = false,
  persianDigits = true,
  tzOffsetMinutes = 210,
  ariaLabel = 'تاریخ شمسی',
  onChange = null,
} = {}) {
  const wrapper = el('div.jalali-date', { role: 'group', 'aria-label': ariaLabel });
  if (id) wrapper.id = id;

  const yearSelect = el('select.jalali-date__year', { 'aria-label': 'سال' });
  const monthSelect = el('select.jalali-date__month', { 'aria-label': 'ماه' });
  const daySelect = el('select.jalali-date__day', { 'aria-label': 'روز' });
  wrapper.append(yearSelect, monthSelect, daySelect);

  const today = isoToJalali(todayIso(tzOffsetMinutes));
  let jy = null;
  let jm = null;
  let jd = null;

  function reset() {
    jy = null;
    jm = null;
    jd = null;
  }

  function currentIso() {
    if (!jy || !jm || !jd) return '';
    return jalaliToIso(jy, jm, jd);
  }

  function option(optionValue, text, selected) {
    return el('option', { value: String(optionValue), text, selected });
  }

  function fillYear() {
    const anchor = jy ?? today.jy;
    const first = Math.min(today.jy - YEARS_BEFORE, anchor);
    const last = Math.max(today.jy + YEARS_AFTER, anchor);
    const nodes = [];
    if (allowEmpty) nodes.push(option('', EMPTY_LABEL, jy === null));
    // newest first: the current year is at the top of the dropdown
    for (let year = last; year >= first; year -= 1) nodes.push(option(year, label(year, persianDigits), year === jy));
    yearSelect.replaceChildren(...nodes);
  }

  function fillMonth() {
    const nodes = [];
    if (allowEmpty) nodes.push(option('', EMPTY_LABEL, jm === null));
    JALALI_MONTHS.forEach((name, index) => nodes.push(option(index + 1, name, index + 1 === jm)));
    monthSelect.replaceChildren(...nodes);
  }

  function fillDay() {
    const length = jy && jm ? jalaliMonthLength(jy, jm) : 31;
    if (jd !== null && jd > length) jd = length; // e.g. 31 → 30 when the month gets shorter
    const nodes = [];
    if (allowEmpty) nodes.push(option('', EMPTY_LABEL, jd === null));
    for (let day = 1; day <= length; day += 1) nodes.push(option(day, label(day, persianDigits), day === jd));
    daySelect.replaceChildren(...nodes);
  }

  function render() {
    fillYear();
    fillMonth();
    fillDay();
  }

  function read() {
    jy = yearSelect.value ? Number(yearSelect.value) : null;
    jm = monthSelect.value ? Number(monthSelect.value) : null;
    jd = daySelect.value ? Number(daySelect.value) : null;
  }

  function handleChange() {
    read();
    render();
    onChange?.(currentIso());
  }

  yearSelect.addEventListener('change', handleChange);
  monthSelect.addEventListener('change', handleChange);
  daySelect.addEventListener('change', handleChange);

  function setValue(next) {
    // a required field always holds a date; optional filters may stay empty
    const iso = next ? String(next).slice(0, 10) : (allowEmpty ? '' : todayIso(tzOffsetMinutes));
    if (!iso) {
      reset();
      render();
      return;
    }
    try {
      const parsed = isoToJalali(iso);
      jy = parsed.jy;
      jm = parsed.jm;
      jd = parsed.jd;
    } catch {
      reset();
    }
    render();
  }

  Object.defineProperty(wrapper, 'value', {
    configurable: true,
    get: currentIso,
    set(next) {
      setValue(next);
      onChange?.(currentIso());
    },
  });

  // required fields start on today; optional filters start empty
  setValue(value);
  return wrapper;
}
