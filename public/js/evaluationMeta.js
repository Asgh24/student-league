/**
 * Client vocabulary of the course-evaluation module. Kept in sync with
 * `src/services/evaluations.js` (a parity test guards the shared constants).
 */

export const SCHOOL_LEVELS = ['پیش‌دبستانی', 'ابتدایی', 'متوسطهٔ اول', 'متوسطهٔ دوم'];

export const GRADES_BY_LEVEL = {
  'پیش‌دبستانی': [],
  'ابتدایی': ['اول', 'دوم', 'سوم', 'چهارم', 'پنجم', 'ششم'],
  'متوسطهٔ اول': ['هفتم', 'هشتم', 'نهم'],
  'متوسطهٔ دوم': ['دهم', 'یازدهم', 'دوازدهم'],
};

export const GRADES = Object.values(GRADES_BY_LEVEL).flat();

export const EVALUATION_KINDS = [
  { key: 'numeric', label: 'کمی (نمره)' },
  { key: 'descriptive', label: 'توصیفی' },
];

export const DESCRIPTIVE_LEVELS = [
  { key: 'excellent', label: 'خیلی خوب', icon: '🌟' },
  { key: 'good', label: 'خوب', icon: '👍' },
  { key: 'fair', label: 'قابل قبول', icon: '🙂' },
  { key: 'needs-work', label: 'نیاز به تلاش', icon: '🎯' },
];

/** Chip colour per qualitative level. */
export const BAND_KIND = {
  excellent: 'gold',
  'very-good': 'ok',
  good: 'amber',
  fair: 'muted',
  'needs-work': 'bad',
};

export function gradesForLevel(level) {
  return GRADES_BY_LEVEL[level] ?? [];
}

export function descriptiveLevel(key) {
  return DESCRIPTIVE_LEVELS.find((level) => level.key === key) ?? null;
}

export function bandKind(key) {
  return BAND_KIND[key] ?? 'muted';
}

/**
 * Qualitative band of a numeric mark, using the usual Iranian thresholds:
 * 20 = عالی، ۱۸+ = خیلی خوب، ۱۵+ = خوب، ۱۰+ = قابل قبول.
 */
export function numericBand(score, scaleMax = 20) {
  if (score === null || score === undefined || score === '') return null;
  const max = Number(scaleMax) || 20;
  const ratio = Number(score) / max;
  if (ratio >= 1) return { key: 'excellent', label: 'عالی', icon: '🌟' };
  if (ratio >= 0.9) return { key: 'very-good', label: 'خیلی خوب', icon: '💎' };
  if (ratio >= 0.75) return { key: 'good', label: 'خوب', icon: '👍' };
  if (ratio >= 0.5) return { key: 'fair', label: 'قابل قبول', icon: '🙂' };
  return { key: 'needs-work', label: 'نیاز به تلاش', icon: '🎯' };
}

/** Band of a stored mark, whichever kind the evaluation uses. */
export function bandFor(evaluation, value) {
  if (!evaluation) return null;
  if (evaluation.kind === 'descriptive') return descriptiveLevel(value?.label ?? '');
  return numericBand(value?.score, evaluation.scaleMax);
}
