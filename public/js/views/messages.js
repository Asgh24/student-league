/** Modern ticket-like inbox shared by teachers and students. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setTopbarTitle } from '../shell.js';
import { emptyState, formDialog, notify } from '../ui.js';
import { button, fa, faDate, faDateTime, pageHead } from './common.js';

let inboxTimer = null;

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
        el('strong', { text: thread.participantName }),
        thread.lastMessage ? el('span.inbox__time', { text: faDateTime(thread.lastMessage.at) }) : null,
      ]),
      el('span.inbox__preview', {
        text: thread.lastMessage?.body ?? 'هنوز پیامی ارسال نشده است',
      }),
    ]),
    thread.unread > 0 ? el('span.inbox__unread', { text: fa(thread.unread), 'aria-label': `${thread.unread} پیام خوانده‌نشده` }) : null,
  ]);
}

export async function renderTeacherMessages() {
  return renderInbox('teacher');
}

export async function renderStudentMessages() {
  return renderInbox('student');
}

async function renderInbox(role) {
  if (inboxTimer) {
    clearInterval(inboxTimer);
    inboxTimer = null;
  }
  setTopbarTitle('پیام‌ها');

  const body = el('div');
  const headAction = button('گفتگوی جدید', { icon: '✍️', onClick: () => startNew() });
  const head = pageHead({
    icon: '💬',
    title: 'پیام‌ها',
    subtitle: role === 'teacher' ? 'گفتگو با دانش‌آموزان و پاسخ به پیام‌ها' : 'پرسش و گفتگو با معلم',
    actions: [headAction],
  });
  renderView([head, body]);
  body.appendChild(el('div.empty', {}, [el('span.empty__icon', { text: '⏳' }), el('p', { text: 'در حال دریافت گفتگوها…' })]));

  let threads = [];
  let contacts = [];
  let activeId = null;
  let activeThread = null;
  let activeMessages = [];
  let contactsLoaded = false;

  const layout = el('div.inbox');
  const listPane = el('aside.inbox__list', { 'aria-label': 'فهرست گفتگوها' });
  const chatPane = el('section.inbox__chat', { 'aria-label': 'گفتگو' });
  layout.append(listPane, chatPane);

  function showPlaceholder() {
    chatPane.replaceChildren(el('div.inbox__placeholder', {}, [
      el('span', { text: '💬', 'aria-hidden': 'true' }),
      el('strong', { text: 'یک گفتگو را انتخاب کنید' }),
      el('p.small.muted', { text: 'پیام‌های خوانده‌نشده با شمارندهٔ بنفش مشخص می‌شوند.' }),
    ]));
  }

  function renderList() {
    listPane.replaceChildren();
    const header = el('div.inbox__list-head', {}, [
      el('strong', { text: 'گفتگوها' }),
      el('span.chip', { text: fa(threads.reduce((sum, thread) => sum + (thread.unread || 0), 0)) }),
    ]);
    listPane.appendChild(header);
    if (threads.length === 0) {
      listPane.appendChild(el('div.inbox__empty', {}, [
        el('span', { text: '📭', 'aria-hidden': 'true' }),
        el('p.small.muted', { text: 'هنوز گفتگویی ندارید.' }),
        button('شروع گفتگو', { kind: 'soft', icon: '✍️', onClick: () => startNew() }),
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
      nodes.push(el('span.bubble__author', { text: message.senderName || (message.senderRole === 'teacher' ? 'معلم' : 'دانش‌آموز') }));
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
        el('p.small.muted', { text: activeThread.subject || (role === 'teacher' ? 'دانش‌آموز' : 'معلم') }),
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

    const composer = el('textarea', {
      id: 'chat-message',
      name: 'message',
      rows: '2',
      maxlength: '4000',
      placeholder: 'پیام خود را بنویسید… (Enter برای ارسال، Shift+Enter برای خط جدید)',
    });
    const send = button('ارسال', { icon: '📤', type: 'submit' });
    const form = el('form.composer', { novalidate: 'true' }, [composer, send]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = composer.value.trim();
      if (!text) return;
      send.disabled = true;
      try {
        const payload = await api.post(`/messages/threads/${activeThread.id}/messages`, { body: text });
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
      el('p.small.muted', { text: 'در حال باز کردن گفتگو…' }),
    ]));
    try {
      const payload = await api.get(`/messages/threads/${id}`);
      activeThread = payload.thread;
      activeMessages = payload.messages ?? [];
      renderChat();
      // Re-rendering the list updates the unread badge: fetching the thread
      // marks the other side's messages as read.
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
      const payload = await api.get('/messages/threads');
      threads = payload?.items ?? [];
      if (render) renderList();
      // An incoming message while the chat is open must appear without a reload.
      if (activeId) {
        const fresh = await api.get(`/messages/threads/${activeId}`);
        const changed = (fresh.messages ?? []).length !== activeMessages.length;
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

  async function loadContacts() {
    if (contactsLoaded) return contacts;
    const payload = await api.get('/messages/contacts');
    contacts = payload?.items ?? [];
    contactsLoaded = true;
    return contacts;
  }

  async function startNew() {
    try {
      const items = await loadContacts();
      if (items.length === 0) {
        notify.warn(role === 'teacher'
          ? 'دانش‌آموزی با حساب کاربری در لیگ‌های شما نیست. ابتدا برای دانش‌آموز حساب بسازید.'
          : 'برای حساب شما معلمی ثبت نشده است.');
        return;
      }
      let payload;
      if (role === 'student') {
        payload = await api.post('/messages/threads', {});
      } else {
        const values = await formDialog({
          title: 'شروع گفتگوی جدید',
          description: 'فقط دانش‌آموزانی که حساب کاربری دارند پیام دریافت می‌کنند.',
          submitLabel: 'شروع گفتگو',
          fields: [{
            name: 'studentId',
            label: 'دانش‌آموز',
            type: 'select',
            required: true,
            options: items.map((item) => ({
              value: item.studentId,
              label: `${item.studentName} — ${item.leagueName}${item.conversationId ? ' (گفتگوی موجود)' : ''}`,
            })),
          }],
        });
        if (!values) return;
        payload = await api.post('/messages/threads', { studentId: Number(values.studentId) });
      }
      if (payload?.thread) {
        await refreshThreads();
        await openThread(payload.thread.id);
      }
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  body.textContent = '';
  body.appendChild(layout);
  try {
    const payload = await api.get('/messages/threads');
    threads = payload?.items ?? [];
    renderList();
    showPlaceholder();
  } catch (error) {
    body.textContent = '';
    body.appendChild(emptyState({ icon: '⚠️', title: 'دریافت پیام‌ها ناموفق بود', hint: errorMessage(error) }));
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
