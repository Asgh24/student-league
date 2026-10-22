/**
 * Teacher-scoped sms.ir settings card, shared by the daily-report page.
 *
 * The API key is write-only: the browser only learns whether a key is already
 * saved. The line number and the exact sample message are shown so the teacher
 * can match the values against their own sms.ir panel before sending anything.
 */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { notify } from '../ui.js';
import { button, card, chip, faDate, field } from './common.js';
import { smsSetupGuideButton } from './smsHelp.js';

function statusText(config) {
  if (config.source === 'teacher' && config.configured) {
    return `پیامک‌ها با حساب sms.ir خودتان و خط ${config.lineNumber} ارسال می‌شوند.`;
  }
  if (config.source === 'server' && config.configured) {
    return `فعلاً از تنظیمات پیامک سرور استفاده می‌شود (خط ${config.lineNumber}). می‌توانید حساب شخصی خودتان را وارد کنید.`;
  }
  if (config.partialOwnSettings) {
    return 'برای فعال‌سازی حساب شخصی، هم کلید API و هم شماره خط لازم است. تا تکمیل هر دو، پیامک‌ها فقط در صف ذخیره می‌شوند.';
  }
  return 'برای ارسال واقعی، کلید API و شماره خط پنل sms.ir خودتان را وارد کنید. تا آن زمان پیامک‌ها در «صف ارسال» باقی می‌مانند و از بین نمی‌روند.';
}

export function smsSettingsCard({
  config = {},
  endpoint = '/sms/settings',
  sampleMessage = '',
  onSaved = null,
  title = 'تنظیمات پیامک من',
} = {}) {
  const own = config.own ?? {};
  const feedback = el('p.small', { role: 'status', 'aria-live': 'polite' });
  const apiKeyInput = el('input', {
    id: 'sms-api-key',
    type: 'password',
    autocomplete: 'new-password',
    maxlength: '300',
    placeholder: own.hasApiKey
      ? 'کلید ذخیره شده است؛ برای تغییر، کلید جدید را وارد کنید'
      : 'کلید API از پنل sms.ir',
  });
  const lineInput = el('input', {
    id: 'sms-line-number',
    type: 'text',
    inputmode: 'numeric',
    maxlength: '20',
    value: own.lineNumber ?? '',
    placeholder: 'مثلاً 30001234',
  });
  const clearKey = el('input', { id: 'sms-clear-key', type: 'checkbox' });
  const save = button('ذخیرهٔ تنظیمات پیامک', { icon: '💾', type: 'submit' });

  const form = el('form', { novalidate: 'true' }, [
    el('div.grid.grid--two', {}, [
      field('کلید API sms.ir', apiKeyInput, 'این کلید فقط یک‌بار ذخیره می‌شود و دیگر نمایش داده نمی‌شود.'),
      field('شماره خط ارسال', lineInput, 'همان شماره خطی که در پنل sms.ir برای ارسال پیامک فعال است.'),
    ]),
    el('div.row', { style: { flexWrap: 'wrap', gap: '10px', alignItems: 'center' } }, [
      own.hasApiKey
        ? el('label.row', { style: { gap: '6px' } }, [
          clearKey,
          el('span.small', { text: 'کلید ذخیره‌شده حذف شود' }),
        ])
        : null,
      el('span.spacer'),
      save,
    ]),
    feedback,
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.textContent = '';
    const apiKey = apiKeyInput.value.trim();
    const lineNumber = lineInput.value.trim();
    if (lineNumber && !/^\d{3,20}$/.test(lineNumber)) {
      feedback.textContent = 'شماره خط باید فقط شامل رقم (۳ تا ۲۰ رقم) باشد.';
      lineInput.focus();
      return;
    }
    if (!apiKey && !clearKey.checked && lineNumber === (own.lineNumber ?? '')) {
      feedback.textContent = 'تغییری برای ذخیره وارد نشده است.';
      return;
    }
    const payload = { lineNumber };
    if (apiKey && !clearKey.checked) payload.apiKey = apiKey;
    if (clearKey.checked) payload.clearApiKey = true;

    save.disabled = true;
    try {
      const result = await api.put(endpoint, payload);
      apiKeyInput.value = '';
      clearKey.checked = false;
      notify.ok('تنظیمات پیامک ذخیره شد');
      if (onSaved) onSaved(result.config ?? result);
      else feedback.textContent = 'تنظیمات ذخیره شد.';
    } catch (error) {
      feedback.textContent = errorMessage(error);
      notify.error(errorMessage(error));
    } finally {
      save.disabled = false;
    }
  });

  const statusChips = el('div.row', { style: { flexWrap: 'wrap', gap: '6px', marginBottom: '6px' } }, [
    chip(
      config.source === 'teacher' ? 'حساب شخصی شما' : config.source === 'server' ? 'تنظیمات سرور' : 'تنظیم نشده',
      config.configured ? 'ok' : 'amber',
    ),
    chip(`خط: ${config.lineNumber || '—'}`, 'muted'),
    chip(`کلید API: ${config.hasApiKey ? 'ذخیره‌شده' : 'ثبت‌نشده'}`, config.hasApiKey ? 'ok' : 'muted'),
  ]);

  const sample = sampleMessage
    ? el('div', { style: { marginTop: '10px' } }, [
      el('p.small.muted', { text: 'نمونهٔ متن پیامکی که برای والدین ارسال می‌شود:' }),
      el('pre.report-message__body', { dir: 'rtl', text: sampleMessage }),
    ])
    : null;

  return card({
    title,
    icon: '📱',
    className: 'card--sms-settings',
    actions: [smsSetupGuideButton()],
  }, [
    statusChips,
    el('p.small', { text: statusText(config) }),
    el('p.small.muted', {}, [
      el('span', { text: 'کلید API و شماره خط را از ' }),
      el('a', {
        href: 'https://sms.ir/',
        target: '_blank',
        rel: 'noopener noreferrer',
        text: 'پنل sms.ir',
      }),
      el('span', { text: ' بردارید. ارسال از مسیر ' }),
      el('code', { text: 'POST /v1/send/bulk' }),
      el('span', { text: ' انجام می‌شود؛ مستندات: ' }),
      el('a', {
        href: 'https://sms.ir/rest-api/',
        target: '_blank',
        rel: 'noopener noreferrer',
        text: 'sms.ir/rest-api',
      }),
    ]),
    form,
    sample,
    el('p.small.muted', {
      text: `اعتبار پیامک و خطوط این حساب در پنل خود sms.ir مدیریت می‌شود؛ این صفحه فقط مشخصات اتصال را ذخیره می‌کند.${config.own?.updatedAt ? ` آخرین ذخیره: ${faDate(config.own.updatedAt)}` : ''}`,
    }),
  ]);
}
