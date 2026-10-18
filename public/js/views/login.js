/** Sign-in screen. Rendered without the app shell chrome. */

import { login, refreshCsrf } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setTopbarTitle } from '../shell.js';
import { homePath, setUser, state } from '../store.js';

export function renderLogin({ navigate }) {
  setTopbarTitle(state.meta.appName);

  const errorBox = el('p.small', { style: { color: '#dc2626', minHeight: '1.2em' }, role: 'alert' });
  const username = el('input', {
    id: 'login-username',
    name: 'username',
    type: 'text',
    required: 'true',
    autocomplete: 'username',
    placeholder: 'نام کاربری',
  });
  const password = el('input', {
    id: 'login-password',
    name: 'password',
    type: 'password',
    required: 'true',
    autocomplete: 'current-password',
    placeholder: 'گذرواژه',
  });
  const submit = el('button.btn.btn--block', { type: 'submit' }, [
    el('span', { text: '🔓', 'aria-hidden': 'true' }),
    el('span', { text: 'ورود به سامانه' }),
  ]);

  const form = el('form.card.login-card', { novalidate: 'true' }, [
    el('div.login-brand', {}, [
      el('div.login-brand__logo', { text: '🏆', 'aria-hidden': 'true' }),
      el('h1.brand-gradient', { text: state.meta.appName }),
      el('p.muted.small', { text: 'لیگ کلاسی، امتیازدهی، حضور و غیاب و ابزارهای آموزشی' }),
    ]),
    el('div.field', {}, [el('label', { for: 'login-username', text: 'نام کاربری' }), username]),
    el('div.field', {}, [el('label', { for: 'login-password', text: 'گذرواژه' }), password]),
    errorBox,
    submit,
    el('p.muted.small', { style: { textAlign: 'center' }, text: 'برای معلمان و دانش‌آموزان دارای حساب کاربری' }),
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    errorBox.textContent = '';
    const user = username.value.trim();
    const pass = password.value;
    if (!user || !pass) {
      errorBox.textContent = 'نام کاربری و گذرواژه را وارد کنید';
      return;
    }
    submit.disabled = true;
    submit.lastChild.textContent = 'در حال ورود…';
    login(user, pass)
      .then((payload) => {
        setUser(payload?.user ?? null);
        navigate(homePath());
      })
      .catch((error) => {
        errorBox.textContent = errorMessage(error);
      })
      .finally(() => {
        submit.disabled = false;
        submit.lastChild.textContent = 'ورود به سامانه';
      });
  });

  renderView(el('div.login-shell', {}, [form]));
  username.focus();

  // Warm up a token bound to the current session (it may have been rotated by a
  // logout or an expired cookie). Submitting stays possible meanwhile, and the
  // api client retries once with a fresh token if it is stale by then.
  void refreshCsrf();
  return undefined;
}
