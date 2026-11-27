/** In-site notification centre shared by teachers, students and the admin panel. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { refreshNotificationsBadge, updateNotificationsBadge } from '../notifications.js';
import { renderView, setTopbarTitle } from '../shell.js';
import { can, isAdmin, isAssistant, isTeacher } from '../store.js';
import { confirmDialog, emptyState, notify } from '../ui.js';
import { button, chip, faDateTime, loadingNode, pageHead } from './common.js';

const CATEGORIES = {
  info: { label: 'اطلاعیه', icon: '📢', tone: '' },
  success: { label: 'خبر خوب', icon: '✅', tone: 'ok' },
  warning: { label: 'هشدار', icon: '⚠️', tone: 'amber' },
  urgent: { label: 'فوری', icon: '🚨', tone: 'bad' },
};

function categoryOf(key) {
  return CATEGORIES[key] ?? CATEGORIES.info;
}

function notificationItem(item, { onOpen, onDelete }) {
  const category = categoryOf(item.category);
  const unread = !item.readAt;
  const node = el(`article.notif${unread ? '.is-unread' : ''}`);

  node.appendChild(el('span.notif__icon', { text: category.icon, 'aria-hidden': 'true' }));

  const head = el('div.notif__head', {}, [
    el('strong.notif__title', { text: item.title }),
    chip(category.label, category.tone),
    item.pinned ? chip('📌 سنجاق‌شده', 'gold') : null,
    unread ? el('span.notif__dot', { title: 'خوانده‌نشده', 'aria-label': 'خوانده‌نشده' }) : null,
  ]);

  const body = el('div.notif__body', {}, [
    head,
    el('p.notif__text', { text: item.body }),
    el('div.notif__meta', {}, [
      el('span', { text: `از طرف ${item.senderName}` }),
      el('span', { text: faDateTime(item.createdAt) }),
    ]),
  ]);

  const actions = el('div.notif__actions', {}, [
    button(item.link ? 'مشاهده' : 'خواندم', {
      kind: item.link ? 'primary' : 'soft',
      icon: item.link ? '↗️' : '✓',
      onClick: () => onOpen(item),
    }),
    button('حذف', { kind: 'ghost', icon: '🗑️', onClick: () => onDelete(item) }),
  ]);

  node.appendChild(body);
  node.appendChild(actions);
  node.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    onOpen(item);
  });
  return node;
}

export function renderNotifications() {
  setTopbarTitle('اعلان‌ها');
  const admin = isAdmin();
  const teacher = isTeacher() && !admin;
  const composeHref = admin ? 'admin/notifications/new' : 'teacher/notifications/new';

  const listHost = el('div.notifs');
  const unreadTab = el('button.tab', { type: 'button' });
  const allTab = el('button.tab.is-active', { type: 'button', text: 'همه اعلان‌ها' });
  const state_ = { unread: false, page: 1, items: [], unreadTotal: 0 };

  const markAll = button('خواندن همه', {
    kind: 'soft',
    icon: '✅',
    onClick: () => void markAllRead(),
  });
  const canCompose = admin || (teacher && (!isAssistant() || can('notifications')));
  const compose = canCompose
    ? el(`a.btn.btn--primary`, { href: `#/${composeHref}` }, [
      el('span', { text: '✍️', 'aria-hidden': 'true' }),
      el('span', { text: admin ? 'ارسال اعلان همگانی' : 'ارسال اعلان' }),
    ])
    : null;

  const head = pageHead({
    icon: '🔔',
    title: 'اعلان‌ها',
    subtitle: admin
      ? 'اطلاعیه‌های سایت برای شما و ارسال پیام همگانی به همه کاربران'
      : teacher
        ? 'پیام‌های معلم و مدیر سامانه برای شما؛ می‌توانید برای دانش‌آموزان لیگ اعلان بفرستید'
        : 'پیام‌ها و اطلاعیه‌های معلم و مدیر سامانه',
    actions: [compose].filter(Boolean),
  });

  function paintTabs() {
    unreadTab.textContent = '';
    unreadTab.appendChild(el('span', { text: 'خوانده‌نشده‌ها' }));
    if (state_.unreadTotal > 0) {
      unreadTab.appendChild(el('span.tab__badge', { text: String(state_.unreadTotal) }));
    }
  }

  function paintList() {
    if (state_.items.length === 0) {
      listHost.replaceChildren(emptyState({
        icon: state_.unread ? '📭' : '🔔',
        title: state_.unread ? 'اعلان خوانده‌نشده‌ای ندارید' : 'هنوز اعلانی دریافت نکرده‌اید',
        hint: 'اعلان‌های معلم و مدیر سامانه اینجا نمایش داده می‌شوند.',
      }));
      return;
    }
    listHost.replaceChildren(...state_.items.map((item) => notificationItem(item, {
      onOpen: (target) => void openItem(target),
      onDelete: (target) => void removeItem(target),
    })));
  }

  async function load() {
    listHost.replaceChildren(loadingNode('در حال دریافت اعلان‌ها…'));
    try {
      const query = state_.unread ? '?unread=1&limit=100' : '?limit=100';
      const payload = await api.get(`/notifications${query}`);
      state_.items = payload?.items ?? [];
      state_.unreadTotal = payload?.unreadTotal ?? 0;
      state_.page = payload?.page ?? 1;
      updateNotificationsBadge(state_.unreadTotal);
      paintTabs();
      paintList();
      markAll.disabled = state_.unreadTotal === 0;
    } catch (error) {
      listHost.replaceChildren(emptyState({
        icon: '⚠️',
        title: 'دریافت اعلان‌ها ناموفق بود',
        hint: errorMessage(error),
      }));
      markAll.disabled = true;
    }
  }

  async function openItem(item) {
    try {
      if (!item.readAt) {
        const payload = await api.post(`/notifications/${item.id}/read`);
        item.readAt = new Date().toISOString();
        state_.unreadTotal = payload?.unreadTotal ?? Math.max(0, state_.unreadTotal - 1);
        updateNotificationsBadge(state_.unreadTotal);
        paintTabs();
      }
      if (item.link) {
        window.location.hash = `#/${String(item.link).replace(/^#?\/?/, '')}`;
        return;
      }
      paintList();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function removeItem(item) {
    const confirmed = await confirmDialog({
      title: 'حذف اعلان',
      message: 'این اعلان از صندوق شما حذف شود؟ (برای دیگران باقی می‌ماند)',
      confirmLabel: 'حذف',
      danger: true,
    });
    if (!confirmed) return;
    try {
      const payload = await api.del(`/notifications/${item.id}`);
      state_.items = state_.items.filter((row) => row.id !== item.id);
      state_.unreadTotal = payload?.unreadTotal ?? state_.unreadTotal;
      updateNotificationsBadge(state_.unreadTotal);
      paintTabs();
      paintList();
      notify.ok('اعلان حذف شد');
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function markAllRead() {
    try {
      await api.post('/notifications/read-all');
      updateNotificationsBadge(0);
      notify.ok('همه اعلان‌ها خوانده شد');
      await load();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  allTab.addEventListener('click', () => {
    if (!state_.unread) return;
    state_.unread = false;
    allTab.classList.add('is-active');
    unreadTab.classList.remove('is-active');
    void load();
  });
  unreadTab.addEventListener('click', () => {
    if (state_.unread) return;
    state_.unread = true;
    unreadTab.classList.add('is-active');
    allTab.classList.remove('is-active');
    void load();
  });

  const toolbar = el('div.notifs__toolbar', {}, [
    el('div.tabs', {}, [allTab, unreadTab]),
    el('div.row', {}, [markAll]),
  ]);

  renderView([head, toolbar, listHost]);
  paintTabs();
  void load();
  void refreshNotificationsBadge();
  return undefined;
}

export function renderStudentNotifications() {
  return renderNotifications();
}
