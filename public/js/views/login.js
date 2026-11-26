/** Sign-in and teacher self-registration. Rendered without app chrome. */

import { login, refreshCsrf, register } from '../api.js';
import { el } from '../dom.js';
import { errorMessage, number } from '../format.js';
import { renderView, setTopbarTitle } from '../shell.js';
import { homePath, setUser, state } from '../store.js';
import { notify } from '../ui.js';
import { planPrice } from './common.js';
import { openGuestSupportDialog } from './guestSupport.js';
import { startInstall } from './installDialog.js';

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
    planPrice(plan, money),
    el('p.small.muted', { text: `${number(plan.days, state.persianDigits)} روز دسترسی کامل` }),
    plan.description ? el('p.small', { text: plan.description }) : null,
  ]);
}

/**
 * One card per headline capability. The copy stays short on purpose: the
 * landing page is a shop window, the full details live in the README and the
 * in-app help.
 */
const FEATURES = [
  {
    icon: '🏆',
    title: 'لیگ و امتیازدهی زنده',
    text: 'لیگ انفرادی و تیمی با ستون‌های امتیاز پویا، رتبه‌بندی لحظه‌ای، مدال قهرمانی و تاریخچهٔ کامل هر تغییر.',
    tags: ['لیگ تیمی', 'رتبه‌بندی', 'مدال'],
  },
  {
    icon: '📝',
    title: 'ارزشیابی و کارنامه',
    text: 'ثبت نمرهٔ عددی یا توصیفی برای هر درس، تبدیل هوشمند نمره به امتیاز لیگ و کارنامهٔ نموداری برای دانش‌آموز.',
    tags: ['توصیفی', 'عددی', 'نمودار'],
  },
  {
    icon: '🗓️',
    title: 'حضور و غیاب و برنامهٔ هفتگی',
    text: 'ثبت روزانهٔ حاضر، غایب و تأخیر، نسبت حضور هر دانش‌آموز و برنامهٔ شنبه تا جمعه که دانش‌آموز هم می‌بیند.',
    tags: ['حضور روزانه', 'برنامهٔ کلاس'],
  },
  {
    icon: '💬',
    title: 'گزارش روزانه و پیامک والدین',
    text: 'گزارش خودکار عملکرد هر دانش‌آموز با پیامک یا شاد، پیام دلخواه به والدین و صندوق خروجی قابل پیگیری.',
    tags: ['پیامک', 'شاد', 'والدین'],
  },
  {
    icon: '🎯',
    title: 'ابزارهای زندهٔ کلاس',
    text: 'قرعه‌کشی، گردونهٔ شانس، تایمر، نمایندهٔ منصفانهٔ کلاس و تابلوی زندهٔ رده‌بندی برای نمایش روی ویدیوپروژکتور.',
    tags: ['قرعه‌کشی', 'تابلوی زنده'],
  },
  {
    icon: '🤖',
    title: 'سؤال‌سازی با هوش مصنوعی',
    text: 'قالب آماده را به هر چت هوش مصنوعی بدهید و پاسخ JSON را برگردانید؛ سؤال‌ها بدون هیچ کلید API ساخته و ذخیره می‌شوند.',
    tags: ['بدون کلید API', 'آزمون'],
  },
  {
    icon: '🛡️',
    title: 'چند معلمی، اشتراک و بکاپ',
    text: 'ثبت‌نام آزمایشی، پنل مدیر، پرداخت زرین‌پال و پشتیبان‌گیری خودکار؛ داده‌های کلاس همیشه قابل بازیابی‌اند.',
    tags: ['۱۴ روز رایگان', 'بکاپ خودکار'],
  },
];

/** Kept module level so navigating away and back never stacks observers. */
let featureObserver = null;

function featureCard(feature, index) {
  return el('li.feature-card', { dataset: { index: String(index + 1) } }, [
    el('span.feature-card__aura', { 'aria-hidden': 'true' }),
    el('div.feature-card__head', {}, [
      el('span.feature-card__icon', { text: feature.icon, 'aria-hidden': 'true' }),
      el('span.feature-card__num', {
        text: number(index + 1, true).padStart(2, '۰'),
        'aria-hidden': 'true',
      }),
    ]),
    el('h3.feature-card__title', { text: feature.title }),
    el('p.feature-card__text', { text: feature.text }),
    el('ul.feature-card__tags', {}, feature.tags.map((tag) => el('li', { text: tag }))),
  ]);
}

/** Reveals each card once, as it scrolls into view (with a reduced-motion path). */
function animateFeatureCards(section) {
  const cards = [...section.querySelectorAll('.feature-card')];
  const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent ?? '');
  const prefersReducedMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (isJsdom || prefersReducedMotion || typeof window.IntersectionObserver !== 'function') {
    cards.forEach((card) => card.classList.add('is-visible'));
    return;
  }

  featureObserver?.disconnect();
  try {
    featureObserver = new window.IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        featureObserver?.unobserve(entry.target);
      }
    }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
  } catch {
    // Never leave the showcase invisible if the observer cannot be created.
    cards.forEach((card) => card.classList.add('is-visible'));
    return;
  }
  cards.forEach((card) => featureObserver.observe(card));
}

/** Closing card that turns the showcase into a signup entry point. */
function ctaCard(onStart) {
  const trialDays = number(state.meta.trialDays ?? 14, true);
  return el('li.feature-card.feature-card--cta', {}, [
    el('span.feature-card__aura', { 'aria-hidden': 'true' }),
    el('span.feature-card__icon.feature-card__icon--cta', { text: '🚀', 'aria-hidden': 'true' }),
    el('h3.feature-card__title', { text: 'آمادهٔ شروع هستید؟' }),
    el('p.feature-card__text', {
      text: `همین حالا حساب معلم بسازید؛ ${trialDays} روز همهٔ ابزارها بدون هزینه باز است و بعد از آن طرح دلخواهتان را انتخاب می‌کنید.`,
    }),
    el('button.btn.feature-card__cta', { type: 'button', onclick: onStart }, [
      el('span', { text: '✨', 'aria-hidden': 'true' }),
      el('span', { text: 'شروع دورهٔ آزمایشی' }),
    ]),
  ]);
}

/** Visual showcase of the product below the plans, one card at a time. */
function featuresSection(onStart) {
  const section = el('section.login-features#features', {
    'aria-labelledby': 'features-title',
  }, [
    el('div.login-features__head', {}, [
      el('span.login-features__eyebrow', {}, [
        el('span', { text: '✨', 'aria-hidden': 'true' }),
        el('span', { text: 'فراتر از یک دفتر نمره' }),
      ]),
      el('h2#features-title', {}, [
        el('span.brand-gradient', { text: 'قابلیت‌هایی' }),
        el('span', { text: ' که کلاس را زنده می‌کند' }),
      ]),
      el('p', {
        text: 'هر چیزی که یک معلم برای ادارهٔ کلاس نیاز دارد، از امتیازدهی و ارزشیابی تا پیامک والدین و ابزارهای زندهٔ کلاس، در یک سامانهٔ یکپارچه.',
      }),
    ]),
    el('ol.login-features__grid', { role: 'list' }, [...FEATURES.map(featureCard), ctaCard(onStart)]),
    el('p.login-features__hint', {}, [
      el('span.login-features__arrow', { text: '↓', 'aria-hidden': 'true' }),
      el('span', { text: 'برای دیدن همهٔ قابلیت‌ها اسکرول کنید' }),
    ]),
  ]);
  animateFeatureCards(section);
  return section;
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

/** Guests can pin the site to their home screen before signing in. */
function installButton() {
  return el('button.btn.btn--ghost.btn--sm', {
    type: 'button',
    onclick: () => void startInstall(),
  }, [
    el('span', { text: '📲', 'aria-hidden': 'true' }),
    el('span', { text: 'افزودن به صفحهٔ اصلی گوشی' }),
  ]);
}

export function renderLogin({ navigate }) {
  setTopbarTitle(state.meta.appName);
  // A previous visit may still have an observer attached to detached cards.
  featureObserver?.disconnect();
  featureObserver = null;

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
      el('span.login-brand__wordmark.brand-gradient', { text: state.meta.brandName || 'تیچ لینک' }),
      el('h1.brand-gradient', { text: state.meta.appName }),
      el('p.login-brand__tagline', { text: 'لیگ کلاسی، امتیازدهی، حضور و غیاب و ابزارهای آموزشی' }),
    ]),
    el('div.tabs', {}, [loginTab, signupTab]),
    loginFields,
    signupFields,
    errorBox,
    submit,
    el('p.muted.small', { style: { textAlign: 'center' }, text: 'دانش‌آموزان از حساب ساخته‌شده توسط معلم وارد می‌شوند. مدیر سامانه هم از همین صفحه وارد می‌شود.' }),
    el('div.row', { style: { justifyContent: 'center', marginTop: '10px' } }, [installButton(), supportButton()]),
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
    el('div.login-page', {}, [
      form,
      plansSection(),
      featuresSection(() => {
        setMode('signup');
        form.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        signupUsername.focus({ preventScroll: true });
      }),
    ]),
  ]));
  loginUsername.focus();

  // Warm up a token bound to the current session (it may have been rotated by a
  // logout or an expired cookie). Submitting stays possible meanwhile, and the
  // api client retries once with a fresh token if it is stale by then.
  void refreshCsrf();
  return undefined;
}
