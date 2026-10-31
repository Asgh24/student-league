/** Teacher password change and the Persian digit preference (students). */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setTopbarTitle } from '../shell.js';
import { isStudent, setPersianDigits, state } from '../store.js';
import { notify } from '../ui.js';
import { button, card, field, pageHead } from './common.js';

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

/** Students cannot change their own password; the teacher does it for them. */
function studentPasswordNote() {
  return card({ title: 'گذرواژه', icon: '🔒' }, [
    el('p.small', { text: 'تغییر گذرواژه فقط توسط معلم انجام می‌شود. اگر گذرواژهٔ خود را فراموش کرده‌اید، از معلم بخواهید آن را تغییر دهد.' }),
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

export function renderSettings() {
  setTopbarTitle('تنظیمات');
  const cards = [isStudent() ? studentPasswordNote() : passwordCard()];
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
