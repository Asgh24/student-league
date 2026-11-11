/**
 * Shared homework vocabulary: Persian labels and the points rule.
 *
 *  - «انجام شد» awards the homework reward (`points`).
 *  - «غایب» deducts the same reward, as before.
 *  - «انجام نشده»، «ناقص» و «نیاورده» deduct the optional penalty
 *    (`penalty_points`, zero by default so old assignments keep their rule).
 *
 * Used by the homework routes (scoring) and the daily parent report (message).
 */
export const HOMEWORK_STATUSES = ['done', 'not_done', 'incomplete', 'absent', 'not_brought'];

export const HOMEWORK_STATUS_LABELS = {
  done: 'انجام شد',
  not_done: 'انجام نشد',
  incomplete: 'ناقص',
  absent: 'غایب',
  not_brought: 'نیاورده',
};

export function pointsForStatus(status, points, penalty = 0) {
  const reward = Number(points) || 0;
  const fine = Number(penalty) || 0;
  if (status === 'done') return reward;
  if (status === 'absent') return -reward;
  if (status === 'not_done' || status === 'incomplete' || status === 'not_brought') {
    return -Math.abs(fine);
  }
  return 0;
}
