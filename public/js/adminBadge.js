/** Live numeric badge for card receipts waiting in the admin payments panel. */

import { api } from './api.js';
import { number } from './format.js';
import { isAdmin, setAdminPendingPayments, state } from './store.js';

let inFlight = null;
let timer = null;

export function updateAdminPendingBadge(value) {
  const count = Math.max(0, Number.parseInt(value ?? 0, 10) || 0);
  setAdminPendingPayments(count);
  if (typeof document === 'undefined') return count;
  for (const node of document.querySelectorAll('[data-admin-pending]')) {
    node.textContent = count > 0 ? number(count, state.persianDigits) : '';
    node.hidden = count === 0;
  }
  return count;
}

function paint(count) {
  return updateAdminPendingBadge(count);
}

export function refreshAdminPendingBadge() {
  if (!isAdmin()) {
    paint(0);
    return Promise.resolve(0);
  }
  if (inFlight) return inFlight;
  inFlight = api.get('/admin/payments/pending-count')
    .then((payload) => {
      const count = Math.max(0, Number.parseInt(payload?.count ?? 0, 10) || 0);
      paint(count);
      return count;
    })
    .catch(() => state.adminPendingPayments)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Poll while an admin session is open so new receipts appear without a refresh. */
export function startAdminBadgePolling(intervalMs = 30_000) {
  if (timer || typeof window === 'undefined') return;
  timer = window.setInterval(() => {
    if (isAdmin()) void refreshAdminPendingBadge();
  }, intervalMs);
}
