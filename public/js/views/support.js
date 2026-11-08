/** Support tickets: site users message the site management and read replies. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { startVisiblePolling } from '../polling.js';
import { renderView, setTopbarTitle } from '../shell.js';
import { emptyState, formDialog, notify } from '../ui.js';
import { button, chip, fa, faDate, faDateTime, pageHead } from './common.js';

let stopInboxPolling = null;

const STATUS_LABELS = { open: 'باز', answered: 'پاسخ داده شد', closed: 'بسته' };
const STATUS_KINDS = { open: 'amber', answered: 'ok', closed: 'muted' };

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
    el('span.inbox__avatar', { text: initials(thread.participantName), 'aria-hidden': 'true' }),
    el('span.inbox__body', {}, [
      el('span.inbox__row', {}, [
        el('strong', { text: thread.subject || 'بدون عنوان' }),
        thread.lastMessage ? el('span.inbox__time', { text: faDateTime(thread.lastMessage.at) }) : null,
      ]),
      el('span.inbox__preview', {
        text: thread.lastMessage?.body ?? 'هنوز پیامی ارسال نشده است',
      }),
      el('span.inbox__row', {}, [statusChip(thread.status)]),
    ]),
    thread.unread > 0 ? el('span.inbox__unread', { text: fa(thread.unread), 'aria-label': `${thread.unread} پیام خوانده‌نشده` }) : null,
  ]);
}

export async function renderSupport() {
  if (stopInboxPolling) {
    stopInboxPolling();
    stopInboxPolling = null;
  }
  setTopbarTitle('پشتیبانی');

  const body = el('div');
  const head = pageHead({
    icon: '🛎️',
    title: 'پشتیبانی سایت',
    subtitle: 'پیام به مدیریت و پشتیبانی سامانه؛ پاسخ‌ها همین‌جا نمایش داده می‌شوند',
    actions: [button('پیام جدید', { icon: '✍️', onClick: () => startNew() })],
  });
  renderView([head, body]);
  body.appendChild(el('div.empty', {}, [el('span.empty__icon', { text: '⏳' }), el('p', { text: 'در حال دریافت تیکت‌ها…' })]));

  let threads = [];
  let activeId = null;
  let activeThread = null;
  let activeMessages = [];

  const layout = el('div.inbox');
  const listPane = el('aside.inbox__list', { 'aria-label': 'فهرست تیکت‌های پشتیبانی' });
  const chatPane = el('section.inbox__chat', { 'aria-label': 'گفتگو با پشتیبانی' });
  layout.append(listPane, chatPane);

  function showPlaceholder() {
    chatPane.replaceChildren(el('div.inbox__placeholder', {}, [
      el('span', { text: '🛎️', 'aria-hidden': 'true' }),
      el('strong', { text: 'یک تیکت را انتخاب کنید' }),
      el('p.small.muted', { text: 'یا با دکمهٔ «پیام جدید» تیکت تازه‌ای بسازید.' }),
    ]));
  }

  function renderList() {
    listPane.replaceChildren();
    const header = el('div.inbox__list-head', {}, [
      el('strong', { text: 'تیکت‌های من' }),
      el('span.chip', { text: fa(threads.reduce((sum, thread) => sum + (thread.unread || 0), 0)) }),
    ]);
    listPane.appendChild(header);
    if (threads.length === 0) {
      listPane.appendChild(el('div.inbox__empty', {}, [
        el('span', { text: '📭', 'aria-hidden': 'true' }),
        el('p.small.muted', { text: 'هنوز پیامی به پشتیبانی نفرستاده‌اید.' }),
        button('ارسال پیام', { kind: 'soft', icon: '✍️', onClick: () => startNew() }),
      ]));
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
      nodes.push(el('span.bubble__author', { text: message.senderName || (message.senderRole === 'admin' ? 'پشتیبانی' : 'شما') }));
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
      el('span.inbox__avatar', { text: initials(activeThread.participantName), 'aria-hidden': 'true' }),
      el('div', {}, [
        el('strong', { text: activeThread.participantName }),
        el('p.small.muted', { text: activeThread.subject || 'بدون عنوان' }),
        statusChip(activeThread.status),
      ]),
    ]);

    const messagesNode = el('div.chat__messages', { 'aria-live': 'polite' });
    if (activeMessages.length === 0) {
      messagesNode.appendChild(emptyState({ icon: '💬', title: 'هنوز پیامی رد و بدل نشده است', hint: 'اولین پیام را بنویسید.' }));
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
      placeholder: closed ? 'این تیکت بسته شده است؛ برای پیام جدید، تیکت تازه بسازید.' : 'پیام خود را بنویسید… (Enter برای ارسال، Shift+Enter برای خط جدید)',
    });
    const send = button('ارسال', { icon: '📤', type: 'submit', disabled: closed });
    const form = el('form.composer', { novalidate: 'true' }, [composer, send]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = composer.value.trim();
      if (!text) return;
      send.disabled = true;
      try {
        const payload = await api.post(`/support/threads/${activeThread.id}/messages`, { body: text });
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

    chatPane.replaceChildren(headNode, messagesNode, form);
    layout.classList.add('is-chatting');
    const scroll = () => {
      messagesNode.scrollTop = messagesNode.scrollHeight;
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scroll);
    else setTimeout(scroll, 0);
  }

  async function openThread(id) {
    activeId = id;
    renderList();
    chatPane.replaceChildren(el('div.inbox__placeholder', {}, [
      el('span', { text: '⏳' }),
      el('p.small.muted', { text: 'در حال باز کردن تیکت…' }),
    ]));
    try {
      const payload = await api.get(`/support/threads/${id}`);
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
      const payload = await api.get('/support/threads');
      threads = payload?.items ?? [];
      if (render) renderList();
      if (activeId) {
        const fresh = await api.get(`/support/threads/${activeId}`);
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

  async function startNew() {
    const values = await formDialog({
      title: 'پیام به پشتیبانی',
      description: 'پیام شما مستقیم به مدیریت سامانه می‌رسد و پاسخ ایشان همین‌جا نمایش داده می‌شود.',
      submitLabel: 'ارسال پیام',
      fields: [
        { name: 'subject', label: 'عنوان (اختیاری)', type: 'text', placeholder: 'مثلاً مشکل در پرداخت اشتراک' },
        { name: 'body', label: 'متن پیام', type: 'textarea', required: true, placeholder: 'مشکل یا سؤال خود را بنویسید…' },
      ],
    });
    if (!values) return;
    try {
      const payload = await api.post('/support/threads', {
        subject: values.subject.trim(),
        body: values.body.trim(),
      });
      notify.ok('پیام شما برای پشتیبانی ارسال شد');
      await refreshThreads();
      if (payload?.thread) await openThread(payload.thread.id);
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  body.textContent = '';
  body.appendChild(layout);
  try {
    const payload = await api.get('/support/threads');
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
    stopInboxPolling = startVisiblePolling({
      intervalMs: 10000,
      isActive: () => layout.isConnected,
      poll: () => activeId ? refreshThreads(false) : refreshThreads(),
    });
  }
  return undefined;
}
