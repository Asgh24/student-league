/**
 * Step-by-step sms.ir setup guide shown from the daily-report SMS card.
 *
 * The screenshots are bundled locally under `public/img/sms-help/` so the guide
 * works offline and never depends on a CDN. The API key shown in the second
 * screenshot is redacted before publication.
 */

import { el } from '../dom.js';
import { openModal } from '../ui.js';
import { button } from './common.js';

const STEPS = [
  {
    title: 'ساخت کلید API',
    text: 'وارد پنل sms.ir شوید، از منوی «برنامه‌نویسان» گزینهٔ «لیست کلیدهای API» را باز کنید و روی «افزودن کلید جدید» بزنید.',
    image: '/img/sms-help/api-keys-list.png',
    alt: 'صفحه لیست کلیدهای API در sms.ir با مشخص‌شدن مسیر منو و دکمه افزودن کلید جدید',
    caption: 'مسیر: برنامه‌نویسان ← لیست کلیدهای API ← افزودن کلید جدید',
  },
  {
    title: 'کپی کردن کلید',
    text: 'یک عنوان دلخواه (مثلاً «سایت لیگ دانش‌آموزی») بنویسید، نوع را «عملیاتی - Production» و وضعیت را «فعال» بگذارید. روی دکمهٔ «کپی» کنار کلید بزنید و در پایان «ذخیره» را بزنید.',
    image: '/img/sms-help/api-key-details.png',
    alt: 'صفحه جزئیات کلید API با دکمه کپی کلید و دکمه ذخیره',
    caption: 'کلید فقط یک‌بار در این صفحه نشان داده می‌شود؛ همان لحظه کپی کنید و در پنل معلم ذخیره کنید. برای امنیت، مقدار کلید در این تصویر پوشانده شده است.',
  },
  {
    title: 'برداشتن شماره خط',
    text: 'از منوی sms.ir وارد «شماره‌های من» شوید و شمارهٔ خطی را بردارید که وضعیت آن «فعال» و «تأیید شده» است. برای نمونه، شمارهٔ خط در تصویر ۵۰۰۰۴۳۰ است.',
    image: '/img/sms-help/line-numbers.png',
    alt: 'صفحه شماره‌های من در sms.ir با شماره خط فعال و تأییدشده',
    caption: 'در تصویر: ارائه‌دهنده پیشگام‌رایان، نوع تبلیغاتی، وضعیت فعال و تأییدشده. اگر چند خط دارید، همان خطی را انتخاب کنید که می‌خواهید پیامک‌های والدین از آن ارسال شود.',
  },
  {
    title: 'ثبت در تنظیمات پیامک',
    text: 'به همین صفحه برگردید؛ کلید API را در فیلد «کلید API sms.ir» و شماره خط را در «شماره خط ارسال» وارد کنید و «ذخیرهٔ تنظیمات پیامک» را بزنید. بعد از ذخیره، وضعیت «حساب شخصی شما» و متن نمونهٔ پیامک نمایش داده می‌شود.',
  },
];

function figure(step, index) {
  const image = el('img.sms-guide__image', {
    src: step.image,
    alt: step.alt,
    decoding: 'async',
  });
  return el('figure.sms-guide__figure', {}, [
    el('a.sms-guide__zoom', {
      href: step.image,
      target: '_blank',
      rel: 'noopener noreferrer',
      title: 'باز کردن تصویر در اندازهٔ کامل',
      'aria-label': `باز کردن تصویر مرحلهٔ ${index + 1} در اندازهٔ کامل`,
    }, [image]),
    el('figcaption.small.muted', { text: step.caption }),
  ]);
}

function stepCard(step, index) {
  return el('section.sms-guide__step', {}, [
    el('span.sms-guide__number', { text: String(index + 1), 'aria-hidden': 'true' }),
    el('div.sms-guide__content', {}, [
      el('h3.sms-guide__title', { text: step.title }),
      el('p.sms-guide__text', { text: step.text }),
      step.image ? figure(step, index) : null,
    ]),
  ]);
}

/** Opens the guide modal; safe to call from any teacher page. */
export function openSmsSetupGuide() {
  const body = el('div.sms-guide', {}, [
    el('p.sms-guide__intro', {
      text: 'برای ارسال واقعی پیامک به والدین، کلید API و شماره خط مخصوص حساب خودتان را از sms.ir بردارید و در همین صفحه ذخیره کنید. این اطلاعات فقط روی حساب معلم شما نگهداری می‌شود.',
    }),
    ...STEPS.map(stepCard),
    el('div.sms-guide__note', {}, [
      el('strong', { text: 'نکته‌های امنیتی: ' }),
      el('span', {
        text: 'کلید API را در اختیار دیگران قرار ندهید. اگر خط فعال و تأییدشده ندارید، ابتدا در sms.ir خط تهیه کنید. تا زمانی که هر دو مقدار ذخیره نشوند، پیامک‌ها در «صف ارسال» می‌مانند و از بین نمی‌روند.',
      }),
    ]),
  ]);

  const modal = openModal({
    title: 'راهنمایی راه‌اندازی سامانه پیامکی',
    body,
    actions: [{ label: 'بستن', kind: 'ghost' }],
  });
  modal.content.classList.add('modal--sms-guide');
  modal.content.closest('.modal-backdrop')?.classList.add('modal-backdrop--sms-guide');

  const closeButton = el('button.sms-guide__close', {
    id: 'sms-guide-close',
    type: 'button',
    'aria-label': 'بستن راهنمای راه‌اندازی',
    title: 'بستن',
    text: '✕',
    onclick: modal.close,
  });
  modal.content.insertBefore(closeButton, modal.content.firstChild);
  closeButton.focus();
  return modal;
}

/** Header action used by the SMS settings card. */
export function smsSetupGuideButton() {
  const guideButton = button('راهنمایی راه‌اندازی سامانه پیامکی', {
    kind: 'ghost',
    icon: 'ℹ️',
    onClick: openSmsSetupGuide,
  });
  guideButton.id = 'sms-help-button';
  guideButton.classList.add('btn--sm');
  guideButton.setAttribute('aria-haspopup', 'dialog');
  return guideButton;
}
