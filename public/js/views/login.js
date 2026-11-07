/** Sign-in and teacher self-registration. Rendered without app chrome. */

import { login, refreshCsrf, register } from '../api.js';
import { el } from '../dom.js';
import { errorMessage, number } from '../format.js';
import { renderView, setTopbarTitle } from '../shell.js';
import { homePath, setUser, state } from '../store.js';
import { notify } from '../ui.js';
import { openGuestSupportDialog } from './guestSupport.js';

function money(value) {
  try {
    return new Intl.NumberFormat(state.persianDigits ? 'fa-IR' : 'en-US').format(Number(value) || 0);
  } catch {
    return number(value, state.persianDigits);
  }
}

function planPreview(plan) {
  const badge = plan.days >= 365 ? 'بیشترین صرفه‌جویی' : plan.days >= 90 ? 'محبوب' : '';
  return el(`div.plan-card${plan.days >= 90 ? '.plan-card--featured' : ''}`, {}, [
    badge ? el('span.plan-card__badge', { text: badge }) : null,
    el('h3', { text: plan.name }),
    el('div.plan-card__price', {}, [
      el('strong', { text: money(plan.price) }),
      el('span', { text: 'تومان' }),
    ]),
    el('p.small.muted', { text: `${number(plan.days, state.persianDigits)} روز دسترسی کامل` }),
    plan.description ? el('p.small', { text: plan.description }) : null,
  ]);
}

/** Public storefront under the login form, so visitors see the plans first. */
function plansSection() {
  const plans = Array.isArray(state.meta?.plans) ? state.meta.plans : [];
  return el('section.login-plans', {}, [
    el('div.login-plans__head', {}, [
      el('h2', { text: '🛍️ طرح‌های اشتراک سایت' }),
      el('p.muted.small', {
        text: 'هزینهٔ اشتراک تنها برای تأمین هزینه‌های زیرساخت و نگهداری سامانه است و هدف آن درآمدزایی یا کسب سود نیست؛ با انتخاب یک طرح به ادامهٔ مسیر آموزش کمک می‌کنید.',
      }),
    ]),
    plans.length
      ? el('div.plans', {}, plans.map(planPreview))
      : el('p.muted.small', { text: 'در حال حاضر طرح فعالی برای فروش وجود ندارد. برای اطلاع از شرایط با پشتیبانی در ارتباط باشید.' }),
    el('p.small.muted', {
      text: 'برای خرید طرح، از همین صفحه وارد حساب معلم خود شوید یا حساب معلم جدید بسازید و دورهٔ آزمایشی رایگان را شروع کنید.',
    }),
  ]);
}

function supportButton() {
  return el('button.btn.btn--ghost.btn--sm', {
    type: 'button',
    onclick: () => openGuestSupportDialog(),
  }, [
    el('span', { text: '🛎️', 'aria-hidden': 'true' }),
    el('span', { text: 'ارتباط با پشتیبانی سایت' }),
  ]);
}

export function renderLogin({ navigate }) {
  setTopbarTitle(state.meta.appName);

  let mode = 'login';
  const trialDays = state.meta.trialDays ?? 14;
  const trialDaysText = number(trialDays, true);
  const errorBox = el('p.small', { style: { color: '#dc2626', minHeight: '1.2em' }, role: 'alert' });

  // Login and signup get their own controls. A DOM node can only live in one
  // parent, so sharing one input between both panels silently moved it into the
  // hidden signup panel and left the login form with labels but no inputs.
  const loginUsername = el('input', {
    id: 'login-username',
    name: 'username',
    type: 'text',
    required: 'true',
    autocomplete: 'username',
    placeholder: 'نام کاربری',
  });
  const loginPassword = el('input', {
    id: 'login-password',
    name: 'password',
    type: 'password',
    required: 'true',
    autocomplete: 'current-password',
    placeholder: 'گذرواژه',
  });

  const displayName = el('input', {
    id: 'signup-display-name',
    name: 'displayName',
    type: 'text',
    autocomplete: 'name',
    placeholder: 'مثلاً خانم احمدی',
  });
  const signupUsername = el('input', {
    id: 'signup-username',
    name: 'username',
    type: 'text',
    autocomplete: 'username',
    placeholder: 'نام کاربری',
  });
  const signupPassword = el('input', {
    id: 'signup-password',
    name: 'password',
    type: 'password',
    autocomplete: 'new-password',
    placeholder: 'گذرواژه',
  });
  const confirm = el('input', {
    id: 'signup-confirm',
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
    el('div.field', {}, [el('label', { for: 'login-username', text: 'نام کاربری' }), loginUsername]),
    el('div.field', {}, [el('label', { for: 'login-password', text: 'گذرواژه' }), loginPassword]),
  ]);

  const signupFields = el('div', { hidden: true }, [
    el('div.demo-banner', {}, [
      el('strong', { text: `🎁 ${trialDaysText} روز استفادهٔ آزمایشی رایگان` }),
      el('p.small', { text: 'همهٔ ابزارهای معلم بدون محدودیت باز می‌شوند. پس از پایان دوره می‌توانید اشتراک بخرید.' }),
    ]),
    el('div.field', {}, [el('label', { for: 'signup-display-name', text: 'نام و نام خانوادگی' }), displayName]),
    el('div.field', {}, [el('label', { for: 'signup-username', text: 'نام کاربری' }), signupUsername]),
    el('div.field', {}, [el('label', { for: 'signup-password', text: 'گذرواژه' }), signupPassword]),
    el('div.field', {}, [el('label', { for: 'signup-confirm', text: 'تکرار گذرواژه' }), confirm]),
  ]);

  function setMode(next) {
    mode = next;
    const isSignup = mode === 'signup';
    loginTab.classList.toggle('is-active', !isSignup);
    signupTab.classList.toggle('is-active', isSignup);
    loginFields.hidden = isSignup;
    signupFields.hidden = !isSignup;
    displayName.required = isSignup;
    signupUsername.required = isSignup;
    signupPassword.required = isSignup;
    confirm.required = isSignup;
    submit.lastChild.textContent = isSignup ? 'ساخت حساب و شروع دورهٔ آزمایشی' : 'ورود به سامانه';
    submit.firstChild.textContent = isSignup ? '✨' : '🔓';
    errorBox.textContent = '';
    (isSignup ? displayName : loginUsername).focus();
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
    el('div.row', { style: { justifyContent: 'center', marginTop: '10px' } }, [supportButton()]),
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    errorBox.textContent = '';
    const formUsername = mode === 'signup' ? signupUsername : loginUsername;
    const formPassword = mode === 'signup' ? signupPassword : loginPassword;
    const user = formUsername.value.trim();
    const pass = formPassword.value;
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

  renderView(el('div.login-shell', {}, [
    el('div.login-page', {}, [form, plansSection()]),
  ]));
  loginUsername.focus();

  // Warm up a token bound to the current session (it may have been rotated by a
  // logout or an expired cookie). Submitting stays possible meanwhile, and the
  // api client retries once with a fresh token if it is stale by then.
  void refreshCsrf();
  return undefined;
}
