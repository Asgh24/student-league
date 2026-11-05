/**
 * Shared homework status vocabulary: Persian labels and the points rule
 * (انجام‌شده +points، غایب −points، انجام‌نشده/ناقص ۰). Used by the homework
 * routes (scoring) and the daily parent report (message text).
 */
export const HOMEWORK_STATUS_POINTS = { done: 1, not_done: 0, incomplete: 0, absent: -1 };

export const HOMEWORK_STATUS_LABELS = {
  done: 'انجام شد',
  not_done: 'انجام نشد',
  incomplete: 'ناقص',
  absent: 'غایب',
};

export function pointsForStatus(status, points) {
  return (HOMEWORK_STATUS_POINTS[status] ?? 0) * (Number(points) || 0);
}
