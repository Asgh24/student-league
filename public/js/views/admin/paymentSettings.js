/** Admin: destination card details for manual card-to-card payments. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { notify } from '../../ui.js';
import { button, card, errorNode, field, loadingNode, pageHead } from '../common.js';
import { adminTabs } from './common.js';

function formatCard(value) {
  return String(value ?? '').replace(/(.{4})/g, '$1 ').trim();
}

export async function renderAdminPaymentSettings() {
  setTopbarTitle('کارت و پرداخت');
  const body = el('div', {}, [loadingNode()]);
  renderView(el('div', {}, [
    pageHead({
      icon: '💳',
      title: 'کارت و پرداخت',
      subtitle: 'این شماره کارت و نام صاحب کارت به معلمان نمایش داده می‌شود',
    }),
    adminTabs('admin/payment-settings'),
    body,
  ]));

  async function load() {
    body.replaceChildren(loadingNode());
    let payload;
    try {
      payload = await api.get('/admin/payment-settings');
    } catch (error) {
      body.replaceChildren(errorNode(error));
      return;
    }

    const settings = payload.settings ?? {};
    const cardNumber = el('input', {
      id: 'card-number',
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'off',
      placeholder: '6037 1234 5678 9012',
      value: formatCard(settings.cardNumber),
      maxlength: '40',
    });
    const cardHolder = el('input', {
      id: 'card-holder',
      type: 'text',
      autocomplete: 'off',
      placeholder: 'نام و نام خانوادگی صاحب کارت',
      value: settings.cardHolder ?? '',
      maxlength: '80',
    });
    const bankName = el('input', {
      id: 'card-bank',
      type: 'text',
      autocomplete: 'off',
      placeholder: 'نام بانک (اختیاری)',
      value: settings.bankName ?? '',
      maxlength: '60',
    });
    const instructions = el('textarea', {
      id: 'card-instructions',
      rows: '3',
      maxlength: '500',
      placeholder: 'توضیح کوتاه برای معلمان (اختیاری)',
    });
    instructions.value = settings.instructions ?? '';

    const previewNumber = el('strong.receipt-card-number', {
      text: formatCard(settings.cardNumber) || 'شماره کارت ثبت نشده',
    });
    const previewHolder = el('span', { text: settings.cardHolder || 'صاحب کارت ثبت نشده' });
    const previewBank = el('span.small.muted', { text: settings.bankName || '' });
    const status = el('p.small.muted', {
      text: payload.configured
        ? '✅ اطلاعات کارت کامل است و معلمان می‌توانند رسید ارسال کنند.'
        : '⚠️ تا زمانی که شماره کارت و نام صاحب کارت ذخیره نشود، پرداخت کارت به کارت برای معلمان غیرفعال است.',
    });

    cardNumber.addEventListener('input', () => {
      previewNumber.textContent = formatCard(cardNumber.value) || 'شماره کارت ثبت نشده';
    });

    const save = button('ذخیره اطلاعات کارت', {
      icon: '💾',
      kind: 'primary',
      onClick: () => submit(),
    });

    async function submit() {
      const normalized = cardNumber.value.replace(/[\s-]/g, '');
      if (normalized.length < 8 || normalized.length > 30) {
        notify.error('شماره کارت باید بین ۸ تا ۳۰ رقم باشد');
        cardNumber.focus();
        return;
      }
      if (cardHolder.value.trim().length < 2) {
        notify.error('نام صاحب کارت را وارد کنید');
        cardHolder.focus();
        return;
      }
      save.disabled = true;
      try {
        await api.put('/admin/payment-settings', {
          cardNumber: cardNumber.value,
          cardHolder: cardHolder.value,
          bankName: bankName.value,
          instructions: instructions.value,
        });
        notify.ok('اطلاعات کارت ذخیره شد');
        await load();
      } catch (error) {
        notify.error(errorMessage(error));
      } finally {
        save.disabled = false;
      }
    }

    body.replaceChildren(
      el('div.grid', {}, [
        el('section.card.card--brand', {}, [
          el('p.small', { text: 'پیش‌نمایش کارت مقصد' }),
          previewNumber,
          el('div.row', {}, [previewHolder, previewBank]),
          settings.instructions ? el('p.small', { text: settings.instructions }) : null,
        ]),
        card({ title: 'اطلاعات کارت مقصد', icon: '🏦' }, [
          el('div.grid.grid--two', {}, [
            field('شماره کارت', cardNumber, 'ارقام فارسی و فاصله‌ها به‌طور خودکار اصلاح می‌شوند.'),
            field('نام صاحب کارت', cardHolder, 'دقیقاً همان نامی که در حساب بانکی ثبت شده است.'),
            field('نام بانک', bankName),
          ]),
          field('توضیح برای معلمان', instructions, 'مثلاً: پس از واریز، شماره پیگیری را در رسید وارد کنید.'),
          status,
          el('div.row', {}, [save]),
        ]),
        card({ title: 'نکته امنیتی', icon: '🛡️' }, [
          el('p.small.muted', {
            text: 'تصویر رسیدها داخل پوشه خصوصی ذخیره می‌شود و فقط از طریق پنل مدیر و پس از ورود قابل مشاهده است.',
          }),
        ]),
      ]),
    );
  }

  await load();
}
