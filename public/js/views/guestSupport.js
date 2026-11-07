/** Public "ask the site" form for visitors who are not logged in. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { notify, openModal } from '../ui.js';

/**
 * Opens the guest contact dialog. The message is stored for the site admin,
 * who replies using the contact details the visitor leaves. It intentionally
 * does not need a session (the login page is the main entry point).
 */
export function openGuestSupportDialog() {
  const name = el('input', {
    id: 'guest-name',
    name: 'name',
    type: 'text',
    maxlength: '80',
    autocomplete: 'name',
    placeholder: 'نام شما',
  });
  const contact = el('input', {
    id: 'guest-contact',
    name: 'contact',
    type: 'text',
    maxlength: '120',
    autocomplete: 'email',
    placeholder: 'ایمیل یا شمارهٔ تماس',
  });
  const subject = el('input', {
    id: 'guest-subject',
    name: 'subject',
    type: 'text',
    maxlength: '120',
    placeholder: 'موضوع (اختیاری)',
  });
  const bodyText = el('textarea', {
    id: 'guest-body',
    name: 'body',
    rows: '4',
    maxlength: '4000',
    placeholder: 'متن پیام یا سؤال شما',
  });
  const errorBox = el('p.small', { style: { color: '#dc2626', minHeight: '1.2em' }, role: 'alert' });

  const body = el('div.grid', {}, [
    el('p.small.muted', {
      text: 'اگر حساب ندارید هم می‌توانید سؤالتان را بپرسید؛ مدیر سامانه از راه ارتباطی که وارد می‌کنید پاسخ می‌دهد.',
    }),
    el('div.field', {}, [el('label', { for: 'guest-name', text: 'نام' }), name]),
    el('div.field', {}, [el('label', { for: 'guest-contact', text: 'ایمیل یا شمارهٔ تماس' }), contact]),
    el('div.field', {}, [el('label', { for: 'guest-subject', text: 'موضوع' }), subject]),
    el('div.field', {}, [el('label', { for: 'guest-body', text: 'متن پیام' }), bodyText]),
    errorBox,
  ]);

  let busy = false;
  openModal({
    title: 'ارتباط با پشتیبانی سایت',
    body,
    actions: [
      { label: 'انصراف', kind: 'ghost', onClick: ({ close }) => close() },
      {
        label: 'ارسال پیام',
        onClick: async ({ close, button }) => {
          if (busy) return;
          const values = {
            name: name.value.trim(),
            contact: contact.value.trim(),
            subject: subject.value.trim(),
            body: bodyText.value.trim(),
          };
          if (!values.name) {
            errorBox.textContent = 'نام خود را وارد کنید';
            name.focus();
            return;
          }
          if (!values.contact) {
            errorBox.textContent = 'ایمیل یا شمارهٔ تماس را وارد کنید';
            contact.focus();
            return;
          }
          if (!values.body) {
            errorBox.textContent = 'متن پیام را بنویسید';
            bodyText.focus();
            return;
          }
          busy = true;
          button.disabled = true;
          button.textContent = 'در حال ارسال…';
          try {
            await api.post('/support/guest', values);
            close();
            notify.ok('پیام شما ثبت شد؛ مدیر سامانه از راه ارتباطی واردشده پاسخ می‌دهد');
          } catch (error) {
            errorBox.textContent = errorMessage(error);
            busy = false;
            button.disabled = false;
            button.textContent = 'ارسال پیام';
          }
        },
      },
    ],
  });
}
