/**
 * Browser side Jalali calendar helpers. This mirrors src/lib/jalali.js so the
 * UI can render Persian dates without a server round trip; tests/Jalali keep
 * both implementations in sync (see tests/frontend.test.js).
 */

const div = (a, b) => Math.trunc(a / b);
const mod = (a, b) => a - Math.trunc(a / b) * b;

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
  1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
];

export const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

export const JALALI_WEEKDAYS = ['شنبه', 'یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

const pad = (n, len = 2) => String(n).padStart(len, '0');

function jalCal(jy) {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  if (jy < jp || jy >= BREAKS[bl - 1]) throw new RangeError(`Jalali year out of range: ${jy}`);

  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d -= div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) - 752;
  return d;
}

function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j += div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

export function jalaliToJdn(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

export function jdnToJalali(jdn) {
  const { gy } = d2g(jdn);
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export function toJalali(gy, gm, gd) {
  return jdnToJalali(g2d(gy, gm, gd));
}

export function toGregorian(jy, jm, jd) {
  return d2g(jalaliToJdn(jy, jm, jd));
}

export function isJalaliLeap(jy) {
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  for (let i = 1; i < BREAKS.length; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const gy = jy + 621;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  void leapJ;
  void leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return leap === 0 ? 1 : 0;
}

export function jalaliMonthLength(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeap(jy) ? 30 : 29;
}

export function isoToJalali(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return toJalali(y, m, d);
}

export function jalaliToIso(jy, jm, jd) {
  const g = toGregorian(jy, jm, jd);
  return `${pad(g.gy, 4)}-${pad(g.gm)}-${pad(g.gd)}`;
}

export function toPersianDigits(value) {
  return String(value ?? '').replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
}

/** Formats an ISO timestamp / Date as `1405/05/10` (optionally with time). */
export function formatJalali(value, { persianDigits = true, withTime = false } = {}) {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const j = toJalali(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  let text = `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`;
  if (withTime) text += ` - ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return persianDigits ? toPersianDigits(text) : text;
}

/** Formats an ISO calendar date (`YYYY-MM-DD`) as a Jalali date. */
export function formatJalaliDate(iso, options = {}) {
  if (iso === null || iso === undefined || iso === '') return '';
  const j = isoToJalali(iso);
  const text = `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`;
  return options.persianDigits === false ? text : toPersianDigits(text);
}

/** Today's calendar date (`YYYY-MM-DD`) in the app timezone. */
export function todayIso(offsetMinutes = 210) {
  const shifted = new Date(Date.now() + offsetMinutes * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Weekday index where 0 = Saturday ... 6 = Friday. */
export function jalaliWeekdayIndex(value) {
  const date = value instanceof Date ? value : new Date(value);
  return (date.getUTCDay() + 1) % 7;
}

export function jalaliWeekdayName(value) {
  return JALALI_WEEKDAYS[jalaliWeekdayIndex(value)];
}
