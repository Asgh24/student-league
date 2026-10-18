import { formatJalali, formatJalaliDate, toPersianDigits } from './jalali.js';

/** Number formatting that honours the per-user Persian digit preference. */
export function number(value, persianDigits = true) {
  const n = Number(value ?? 0);
  const text = Number.isFinite(n) ? String(n) : '0';
  return persianDigits ? toPersianDigits(text) : text;
}

export function dateTime(value, persianDigits = true) {
  return formatJalali(value, { persianDigits, withTime: true });
}

export function dateOnly(value, persianDigits = true) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return formatJalaliDate(value, { persianDigits });
  }
  return formatJalali(value, { persianDigits });
}

export function bytes(size) {
  const units = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
  let value = Number(size ?? 0);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const rounded = index === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${toPersianDigits(rounded)} ${units[index]}`;
}

export const ATTENDANCE_LABELS = {
  present: 'حاضر',
  absent: 'غایب',
  late: 'تأخیر',
};

export const STATUS_CHIP_CLASS = {
  present: 'chip chip--ok',
  absent: 'chip chip--bad',
  late: 'chip chip--amber',
};

export function rating(total) {
  const titles = [
    [2000, 'شاهنشاه', '👑'],
    [1500, 'امپراتور', '🏛️'],
    [1000, 'پادشاه', '🤴'],
    [700, 'شاهزاده', '🎖️'],
    [400, 'سردار', '⚔️'],
    [200, 'فرمانده', '🛡️'],
    [50, 'جنگجو', '🗡️'],
    [-Infinity, 'نوآموز', '🌱'],
  ];
  const found = titles.find(([min]) => total >= min);
  return { title: found[1], icon: found[2] };
}

export function errorMessage(error) {
  if (!error) return 'خطای نامشخص';
  if (error.code === 'NETWORK') return error.message;
  const first = Array.isArray(error.details) && error.details.length ? error.details[0] : null;
  if (first && first.message) return `${error.message} (${first.message})`;
  return error.message || 'خطای نامشخص';
}
