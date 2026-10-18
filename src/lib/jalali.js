/**
 * Gregorian <-> Jalali (Solar Hijri) calendar conversion.
 *
 * Original implementation of the well known arithmetic algorithm: the Jalali
 * calendar is anchored on the March equinox, with a 33 year leap cycle and a
 * small table of cycle irregularities. Dates are handled as Julian Day Numbers
 * (JDN) so that conversions are exact and timezone free.
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

export const JALALI_WEEKDAYS = [
  'شنبه', 'یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه',
];

/** Returns the leap flag (0/1) of a Jalali year. */
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
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  void march;
  return leap === 0 ? 1 : 0;
}

/** Number of days in a Jalali month. */
export function jalaliMonthLength(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeap(jy) ? 30 : 29;
}

function jalCal(jy) {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  if (jy < jp || jy >= BREAKS[bl - 1]) throw new RangeError(`Jalali year out of supported range: ${jy}`);

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

export function gregorianToJdn(gy, gm, gd) {
  return g2d(gy, gm, gd);
}

export function jdnToGregorian(jdn) {
  return d2g(jdn);
}

/** Gregorian date parts -> Jalali date parts. */
export function toJalali(gy, gm, gd) {
  return jdnToJalali(g2d(gy, gm, gd));
}

/** Jalali date parts -> Gregorian date parts. */
export function toGregorian(jy, jm, jd) {
  return d2g(jalaliToJdn(jy, jm, jd));
}

const pad = (n, len = 2) => String(n).padStart(len, '0');

/** `YYYY-MM-DD` (Gregorian) for Jalali parts. */
export function jalaliToIsoDate(jy, jm, jd) {
  const g = toGregorian(jy, jm, jd);
  return `${pad(g.gy, 4)}-${pad(g.gm)}-${pad(g.gd)}`;
}

/** Jalali parts for a `YYYY-MM-DD` (Gregorian) string. */
export function isoDateToJalali(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return toJalali(y, m, d);
}

/** Formats an ISO timestamp / Date as a Jalali date string. */
export function formatJalaliDate(value, { digits = 'fa', withTime = false } = {}) {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const j = toJalali(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  let text = `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`;
  if (withTime) text += ` - ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return digits === 'fa' ? toPersianDigitsLocal(text) : text;
}

function toPersianDigitsLocal(text) {
  return String(text).replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
}

/** ISO calendar date (`YYYY-MM-DD`) of "now" for a UTC offset in minutes. */
export function localDateIso(offsetMinutes, date = new Date()) {
  const shifted = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Jalali weekday index where 0 = Saturday ... 6 = Friday. */
export function jalaliWeekdayIndex(date) {
  const d = date instanceof Date ? date : new Date(date);
  // JS getUTCDay: 0=Sunday. Shift so that 0=Saturday.
  return (d.getUTCDay() + 1) % 7;
}

export function isValidJalaliDate(jy, jm, jd) {
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd)) return false;
  if (jm < 1 || jm > 12) return false;
  if (jd < 1 || jd > jalaliMonthLength(jy, jm)) return false;
  try {
    jalCal(jy);
  } catch {
    return false;
  }
  return true;
}
