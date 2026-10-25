/** Shared tab strip for the student portal. */

import { el } from '../../dom.js';

export const STUDENT_TABS = [
  ['student', '🏠', 'میزکار'],
  ['student/report-card', '📄', 'کارنامه'],
  ['student/evaluations', '📝', 'ارزشیابی'],
  ['student/attendance', '🗓️', 'حضور و غیاب'],
  ['student/schedule', '📅', 'برنامه هفتگی'],
  ['student/team', '🛡️', 'تیم من'],
  ['student/history', '📜', 'تاریخچه'],
  ['student/ranking', '🏅', 'رده‌بندی'],
  ['student/likes', '💜', 'لایک'],
  ['student/questions', '❓', 'سوال و پاسخ'],
  ['student/settings', '⚙️', 'تنظیمات'],
];

export function studentTabs(activePath) {
  const row = el('div.tabs');
  for (const [href, icon, label] of STUDENT_TABS) {
    row.appendChild(el(`a.tab${activePath === href ? '.is-active' : ''}`, {
      href: `#/${href}`,
      text: `${icon} ${label}`,
      'aria-current': activePath === href ? 'page' : null,
    }));
  }
  return row;
}
