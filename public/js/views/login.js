/** Sign-in and teacher self-registration. Rendered without app chrome. */

import { login, refreshCsrf, register } from '../api.js';
import { el } from '../dom.js';
import { errorMessage, number } from '../format.js';
import { renderView, setTopbarTitle } from '../shell.js';
import { homePath, setUser, state } from '../store.js';
import { notify } from '../ui.js';

export function renderLogin({ navigate }) {
  setTopbarTitle(state.meta.appName);

  let mode = 'login';
  const trialDays = state.meta.trialDays ?? 14;
  const trialDaysText = number(trialDays, true);
  const errorBox = el('p.small', { style: { color: '#dc2626', minHeight: '1.2em' }, role: 'alert' });

  const displayName = el('input', {
    id: 'login-display-name',
    name: 'displayName',
    type: 'text',
    autocomplete: 'name',
    placeholder: 'مثلاً خانم احمدی',
  });
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
  const confirm = el('input', {
    id: 'login-confirm',
    name: 'confirm',
    type: 'password',
    autocomplete: 'new-password',
    placeholder: 'تکرار گذرواژه',
  });

  const submit = el('button.btn.btn--block', { type: 'submit' }, [
    el('span', { text: '🔓', 'aria-hidden': 'true' }),
    el('span', { text: 'ورود به سامانه' }),
  ]);

  const loginTab = el('button.tab.is-active', { type: 'button', text: 'ورود' });
  const signupTab = el('button.tab', { type: 'button', text: 'ثبت‌نام معلم' });

  const loginFields = el('div', {}, [
    el('div.field', {}, [el('label', { for: 'login-username', text: 'نام کاربری' }), username]),
    el('div.field', {}, [el('label', { for: 'login-password', text: 'گذرواژه' }), password]),
  ]);

  const signupFields = el('div', { hidden: true }, [
    el('div.demo-banner', {}, [
      el('strong', { text: `🎁 ${trialDaysText} روز استفادهٔ آزمایشی رایگان` }),
      el('p.small', { text: 'همهٔ ابزارهای معلم بدون محدودیت باز می‌شوند. پس از پایان دوره می‌توانید اشتراک بخرید.' }),
    ]),
    el('div.field', {}, [el('label', { for: 'login-display-name', text: 'نام و نام خانوادگی' }), displayName]),
    el('div.field', {}, [el('label', { for: 'login-username', text: 'نام کاربری' }), username]),
    el('div.field', {}, [el('label', { for: 'login-password', text: 'گذرواژه' }), password]),
    el('div.field', {}, [el('label', { for: 'login-confirm', text: 'تکرار گذرواژه' }), confirm]),
  ]);

  function setMode(next) {
    mode = next;
    const isSignup = mode === 'signup';
    loginTab.classList.toggle('is-active', !isSignup);
    signupTab.classList.toggle('is-active', isSignup);
    loginFields.hidden = isSignup;
    signupFields.hidden = !isSignup;
    displayName.required = isSignup;
    confirm.required = isSignup;
    password.autocomplete = isSignup ? 'new-password' : 'current-password';
    submit.lastChild.textContent = isSignup ? 'ساخت حساب و شروع دورهٔ آزمایشی' : 'ورود به سامانه';
    submit.firstChild.textContent = isSignup ? '✨' : '🔓';
    errorBox.textContent = '';
    (isSignup ? displayName : username).focus();
  }

  loginTab.addEventListener('click', () => setMode('login'));
  signupTab.addEventListener('click', () => setMode('signup'));

  const form = el('form.card.login-card', { novalidate: 'true' }, [
    el('div.login-brand', {}, [
      el('div.login-brand__logo', { text: '🏆', 'aria-hidden': 'true' }),
      el('h1.brand-gradient', { text: state.meta.appName }),
      el('p.muted.small', { text: 'لیگ کلاسی، امتیازدهی، حضور و غیاب و ابزارهای آموزشی' }),
    ]),
    el('div.tabs', {}, [loginTab, signupTab]),
    loginFields,
    signupFields,
    errorBox,
    submit,
    el('p.muted.small', { style: { textAlign: 'center' }, text: 'دانش‌آموزان از حساب ساخته‌شده توسط معلم وارد می‌شوند. مدیر سامانه هم از همین صفحه وارد می‌شود.' }),
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
    if (mode === 'signup') {
      if (!displayName.value.trim()) {
        errorBox.textContent = 'نام و نام خانوادگی را وارد کنید';
        return;
      }
      if (pass.length < 8) {
        errorBox.textContent = 'گذرواژه باید حداقل ۸ نویسه باشد';
        return;
      }
      if (pass !== confirm.value) {
        errorBox.textContent = 'گذرواژه و تکرار آن یکسان نیستند';
        return;
      }
    }

    submit.disabled = true;
    submit.lastChild.textContent = mode === 'signup' ? 'در حال ساخت حساب…' : 'در حال ورود…';
    const request = mode === 'signup'
      ? register(displayName.value.trim(), user, pass)
      : login(user, pass);
    request
      .then((payload) => {
        setUser(payload?.user ?? null);
        if (mode === 'signup') notify.ok(`حساب ساخته شد؛ ${trialDaysText} روز آزمایشی فعال است`);
        navigate(homePath());
      })
      .catch((error) => {
        errorBox.textContent = errorMessage(error);
      })
      .finally(() => {
        submit.disabled = false;
        submit.lastChild.textContent = mode === 'signup' ? 'ساخت حساب و شروع دورهٔ آزمایشی' : 'ورود به سامانه';
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
