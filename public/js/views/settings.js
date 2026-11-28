/** Password change and the Persian digit preference (students). */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { installSnapshot, subscribeInstall } from '../installApp.js';
import { renderView, setTopbarTitle } from '../shell.js';
import { isStudent, setPersianDigits, state } from '../store.js';
import { paletteSwatches } from '../theme.js';
import { notify } from '../ui.js';
import { button, card, field, pageHead } from './common.js';
import { startInstall } from './installDialog.js';

function passwordCard() {
  const current = el('input', { id: 'pw-current', type: 'password', autocomplete: 'current-password', required: 'true' });
  const next = el('input', { id: 'pw-new', type: 'password', autocomplete: 'new-password', required: 'true' });
  const save = button('ذخیره گذرواژه جدید', { onClick: () => submit() });

  async function submit() {
    if (current.value.length < 4 || next.value.length < 6) {
      notify.error('گذرواژه فعلی و گذرواژه جدید (حداقل ۶ نویسه) را وارد کنید');
      return;
    }
    save.disabled = true;
    try {
      await api.post('/auth/password', { currentPassword: current.value, newPassword: next.value });
      current.value = '';
      next.value = '';
      notify.ok('گذرواژه با موفقیت تغییر کرد');
    } catch (error) {
      notify.error(errorMessage(error));
    } finally {
      save.disabled = false;
    }
  }

  return card({ title: 'تغییر گذرواژه', icon: '🔑' }, [
    field('گذرواژه فعلی', current),
    field('گذرواژه جدید', next, 'حداقل ۶ نویسه؛ گذرواژهٔ فارسی هم پذیرفته می‌شود.'),
    el('div.row', {}, [save]),
  ]);
}

function digitsCard() {
  const toggle = el('input', { id: 'digits-toggle', type: 'checkbox' });
  toggle.checked = state.persianDigits;
  const label = el('label.checkbox', { for: 'digits-toggle' }, [toggle, el('span', { text: 'نمایش اعداد به فارسی (۱۲۳۴)' })]);
  toggle.addEventListener('change', async () => {
    const value = toggle.checked;
    setPersianDigits(value);
    try {
      await api.patch('/student/settings', { persianDigits: value });
      notify.ok('تنظیمات ذخیره شد');
    } catch (error) {
      toggle.checked = !value;
      setPersianDigits(!value);
      notify.error(errorMessage(error));
    }
  });
  return card({ title: 'نمایش اعداد', icon: '🔢' }, [
    label,
    el('p.muted.small', { text: 'این تنظیم روی همه اعداد سامانه اثر می‌گذارد.' }),
  ]);
}

function paletteCard() {
  return card({ title: 'پالت رنگی', icon: '🎨' }, [
    el('p.small.muted', { text: 'رنگ‌بندی سامانه را انتخاب کنید. تم پیش‌فرض نارنجی و مشکی است و انتخاب شما در همین مرورگر ذخیره می‌شود.' }),
    paletteSwatches(),
  ]);
}

/**
 * «افزودن به صفحهٔ اصلی»: a shortcut that opens the site like an app. Chrome
 * and Edge fire a native prompt; iOS needs the Safari share sheet, so the same
 * button falls back to written steps.
 */
function installCard() {
  const statusLine = el('p.small.muted.install-card__status');
  const action = button('افزودن به صفحهٔ اصلی گوشی', {
    icon: '📲',
    kind: 'primary',
    onClick: () => void startInstall(),
  });
  const row = el('div.row', {}, [action]);

  function paint(snapshot = installSnapshot()) {
    if (snapshot.installed) {
      statusLine.textContent = '✓ این سایت از قبل روی صفحهٔ اصلی نصب شده است.';
      statusLine.hidden = false;
      row.hidden = true;
      return;
    }
    row.hidden = false;
    statusLine.hidden = !snapshot.ios;
    statusLine.textContent = snapshot.ios
      ? 'در آیفون و آیپد، افزودن میانبر فقط از مرورگر Safari ممکن است؛ راهنمای گام‌به‌گام باز می‌شود.'
      : '';
  }
  paint();

  const unsubscribe = subscribeInstall((snapshot) => {
    if (!statusLine.isConnected) {
      unsubscribe();
      return;
    }
    paint(snapshot);
  });

  return card({ title: 'افزودن به صفحهٔ اصلی گوشی', icon: '📲' }, [
    el('p.small.muted', { text: 'تیچ لینک را مثل یک برنامه روی صفحهٔ اصلی گوشی داشته باشید؛ با همان حساب کاربری باز می‌شود.' }),
    statusLine,
    row,
  ]);
}

export function renderSettings() {
  setTopbarTitle('تنظیمات');
  const cards = [installCard(), paletteCard(), passwordCard()];
  if (isStudent()) cards.push(digitsCard());
  if (state.user) {
    cards.push(card({ title: 'حساب کاربری', icon: '🪪' }, [
      el('p', {}, [
        el('strong', { text: 'نام کاربری: ' }),
        el('span', { text: state.user.username }),
      ]),
      el('p', {}, [
        el('strong', { text: 'نقش: ' }),
        el('span', {
          text: state.user.role === 'admin'
            ? 'مدیر سامانه'
            : state.user.assistant
              ? 'همیار معلم'
              : state.user.role === 'teacher'
                ? 'معلم'
                : 'دانش‌آموز',
        }),
      ]),
      el('p', {}, [
        el('strong', { text: 'نام نمایشی: ' }),
        el('span', { text: state.user.displayName }),
      ]),
    ]));
  }
  renderView([pageHead({ icon: '⚙️', title: 'تنظیمات', subtitle: 'گذرواژه و ترجیحات نمایش' }), el('div.grid.grid--two', {}, cards)]);
  return undefined;
}
