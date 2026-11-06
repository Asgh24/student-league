/** Admin side of support tickets: read user messages and reply. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { emptyState, notify } from '../../ui.js';
import { button, chip, fa, faDate, faDateTime, pageHead } from '../common.js';
import { adminEmpty, adminTabs } from './common.js';

let inboxTimer = null;

const STATUS_LABELS = { open: 'باز', answered: 'پاسخ داده شد', closed: 'بسته' };
const STATUS_KINDS = { open: 'amber', answered: 'ok', closed: 'muted' };
const ROLE_LABELS = { teacher: 'معلم', student: 'دانش‌آموز' };

function statusChip(status) {
  return chip(STATUS_LABELS[status] ?? status, STATUS_KINDS[status] ?? 'muted');
}

function initials(name) {
  const text = String(name ?? '').trim();
  return text ? text.slice(0, 1) : '؟';
}

function dayKey(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function threadItem(thread, active, onOpen) {
  return el(`button.inbox__item${active ? '.is-active' : ''}`, {
    type: 'button',
    onclick: () => onOpen(thread.id),
  }, [
    el('span.inbox__avatar', { text: initials(thread.userName), 'aria-hidden': 'true' }),
    el('span.inbox__body', {}, [
      el('span.inbox__row', {}, [
        el('strong', { text: thread.userName }),
        thread.lastMessage ? el('span.inbox__time', { text: faDateTime(thread.lastMessage.at) }) : null,
      ]),
      el('span.inbox__preview', {
        text: thread.lastMessage?.body ?? 'هنوز پیامی ارسال نشده است',
      }),
      el('span.inbox__row', {}, [
        statusChip(thread.status),
        el('span.small.muted', { text: `${ROLE_LABELS[thread.userRole] ?? thread.userRole} · ${thread.username}` }),
      ]),
    ]),
    thread.unread > 0 ? el('span.inbox__unread', { text: fa(thread.unread), 'aria-label': `${thread.unread} پیام خوانده‌نشده` }) : null,
  ]);
}

export async function renderAdminSupport() {
  if (inboxTimer) {
    clearInterval(inboxTimer);
    inboxTimer = null;
  }
  setTopbarTitle('پشتیبانی');

  const body = el('div');
  renderView([
    pageHead({
      icon: '🛎️',
      title: 'پشتیبانی سایت',
      subtitle: 'پیام‌های کاربران به مدیریت سامانه و پاسخ به آن‌ها',
    }),
    adminTabs('admin/support'),
    body,
  ]);
  body.appendChild(el('div.empty', {}, [el('span.empty__icon', { text: '⏳' }), el('p', { text: 'در حال دریافت تیکت‌ها…' })]));

  let threads = [];
  let activeId = null;
  let activeThread = null;
  let activeMessages = [];

  const layout = el('div.inbox');
  const listPane = el('aside.inbox__list', { 'aria-label': 'فهرست تیکت‌های پشتیبانی' });
  const chatPane = el('section.inbox__chat', { 'aria-label': 'گفتگو با کاربر' });
  layout.append(listPane, chatPane);

  function showPlaceholder() {
    chatPane.replaceChildren(el('div.inbox__placeholder', {}, [
      el('span', { text: '🛎️', 'aria-hidden': 'true' }),
      el('strong', { text: 'یک تیکت را انتخاب کنید' }),
      el('p.small.muted', { text: 'پیام‌های خوانده‌نشده با شمارندهٔ بنفش مشخص می‌شوند.' }),
    ]));
  }

  function renderList() {
    listPane.replaceChildren();
    const header = el('div.inbox__list-head', {}, [
      el('strong', { text: 'تیکت‌ها' }),
      el('span.chip', { text: fa(threads.reduce((sum, thread) => sum + (thread.unread || 0), 0)) }),
    ]);
    listPane.appendChild(header);
    if (threads.length === 0) {
      listPane.appendChild(adminEmpty('هنوز پیامی به پشتیبانی ارسال نشده است'));
      return;
    }
    for (const thread of threads) {
      listPane.appendChild(threadItem(thread, thread.id === activeId, openThread));
    }
  }

  function messageBubble(message, previous) {
    const mine = Boolean(message.mine);
    const showDay = dayKey(previous?.createdAt) !== dayKey(message.createdAt);
    const nodes = [];
    if (showDay) nodes.push(el('div.chat__day', { text: faDate(message.createdAt) }));
    if (!previous || previous.senderRole !== message.senderRole) {
      nodes.push(el('span.bubble__author', { text: message.senderName || (message.senderRole === 'admin' ? 'مدیر سامانه' : 'کاربر') }));
    }
    nodes.push(el('p.bubble__text', { text: message.body }));
    nodes.push(el('span.bubble__time', { text: faDateTime(message.createdAt) }));
    return el(`div.bubble${mine ? '.bubble--mine' : ''}`, {}, nodes);
  }

  function renderChat() {
    if (!activeThread) return showPlaceholder();
    const back = el('button.btn.btn--ghost.btn--sm.inbox__back', {
      type: 'button',
      text: '→ فهرست',
      onclick: () => {
        activeId = null;
        activeThread = null;
        layout.classList.remove('is-chatting');
        renderList();
        showPlaceholder();
      },
    });
    const headNode = el('div.chat__head', {}, [
      back,
      el('span.inbox__avatar', { text: initials(activeThread.userName), 'aria-hidden': 'true' }),
      el('div', {}, [
        el('strong', { text: activeThread.userName }),
        el('p.small.muted', { text: `${activeThread.subject || 'بدون عنوان'} · ${ROLE_LABELS[activeThread.userRole] ?? activeThread.userRole} · ${activeThread.username}` }),
        statusChip(activeThread.status),
      ]),
    ]);

    const messagesNode = el('div.chat__messages', { 'aria-live': 'polite' });
    if (activeMessages.length === 0) {
      messagesNode.appendChild(emptyState({ icon: '💬', title: 'هنوز پیامی رد و بدل نشده است' }));
    } else {
      activeMessages.forEach((message, index) => {
        messagesNode.appendChild(messageBubble(message, activeMessages[index - 1]));
      });
    }

    const closed = activeThread.status === 'closed';
    const composer = el('textarea', {
      id: 'chat-message',
      name: 'message',
      rows: '2',
      maxlength: '4000',
      disabled: closed,
      placeholder: closed ? 'این تیکت بسته شده است؛ برای پاسخ، وضعیت را باز کنید.' : 'پاسخ خود را بنویسید… (Enter برای ارسال، Shift+Enter برای خط جدید)',
    });
    const send = button('ارسال پاسخ', { icon: '📤', type: 'submit', disabled: closed });
    const form = el('form.composer', { novalidate: 'true' }, [composer, send]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = composer.value.trim();
      if (!text) return;
      send.disabled = true;
      try {
        const payload = await api.post(`/admin/support/threads/${activeThread.id}/messages`, { body: text });
        activeMessages.push(payload.message);
        composer.value = '';
        activeThread = payload.thread;
        renderChat();
        await refreshThreads();
      } catch (error) {
        notify.error(errorMessage(error));
      } finally {
        send.disabled = false;
      }
    });
    composer.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });

    const statusRow = el('div.row', { style: { flexWrap: 'wrap', gap: '6px' } }, [
      el('span.small.muted', { text: 'وضعیت تیکت:' }),
      ...['open', 'answered', 'closed'].map((status) => button(
        STATUS_LABELS[status],
        {
          kind: activeThread.status === status ? 'primary' : 'soft',
          onClick: () => setStatus(status),
        },
      )),
    ]);

    chatPane.replaceChildren(headNode, statusRow, messagesNode, form);
    layout.classList.add('is-chatting');
    const scroll = () => {
      messagesNode.scrollTop = messagesNode.scrollHeight;
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scroll);
    else setTimeout(scroll, 0);
  }

  async function setStatus(status) {
    try {
      const payload = await api.patch(`/admin/support/threads/${activeThread.id}/status`, { status });
      activeThread = payload.thread;
      notify.ok(`وضعیت تیکت: ${STATUS_LABELS[status]}`);
      renderChat();
      await refreshThreads();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function openThread(id) {
    activeId = id;
    renderList();
    chatPane.replaceChildren(el('div.inbox__placeholder', {}, [
      el('span', { text: '⏳' }),
      el('p.small.muted', { text: 'در حال باز کردن تیکت…' }),
    ]));
    try {
      const payload = await api.get(`/admin/support/threads/${id}`);
      activeThread = payload.thread;
      activeMessages = payload.messages ?? [];
      renderChat();
      await refreshThreads();
    } catch (error) {
      notify.error(errorMessage(error));
      activeId = null;
      activeThread = null;
      showPlaceholder();
    }
  }

  async function refreshThreads(render = true) {
    try {
      const payload = await api.get('/admin/support/threads');
      threads = payload?.items ?? [];
      if (render) renderList();
      if (activeId) {
        const fresh = await api.get(`/admin/support/threads/${activeId}`);
        const changed = (fresh.messages ?? []).length !== activeMessages.length
          || fresh.thread.status !== activeThread?.status;
        activeThread = fresh.thread;
        if (changed) {
          const draft = chatPane.querySelector('#chat-message')?.value ?? '';
          activeMessages = fresh.messages ?? [];
          renderChat();
          const box = chatPane.querySelector('#chat-message');
          if (box) {
            box.value = draft;
            if (draft) box.focus();
          }
        }
      }
    } catch {
      /* polling must not interrupt typing */
    }
  }

  body.textContent = '';
  body.appendChild(layout);
  try {
    const payload = await api.get('/admin/support/threads');
    threads = payload?.items ?? [];
    renderList();
    showPlaceholder();
  } catch (error) {
    body.textContent = '';
    body.appendChild(emptyState({ icon: '⚠️', title: 'دریافت تیکت‌ها ناموفق بود', hint: errorMessage(error) }));
    return undefined;
  }

  const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent ?? '');
  if (!isJsdom) {
    inboxTimer = setInterval(() => {
      if (!layout.isConnected) {
        clearInterval(inboxTimer);
        inboxTimer = null;
        return;
      }
      if (!activeId) void refreshThreads();
      else void refreshThreads(false);
    }, 10000);
  }
  return undefined;
}
