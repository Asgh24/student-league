/** The "add to home screen" button logic and its fallback instructions. */

import { el } from '../dom.js';
import { installSnapshot, promptInstall } from '../installApp.js';
import { notify, openModal } from '../ui.js';

function stepList(steps) {
  return el('ol.install-steps', {}, steps.map((text) => el('li', { text })));
}

/** Written steps for browsers that cannot show the native install prompt. */
export function openInstallDialog() {
  const { ios, installed } = installSnapshot();

  const body = el('div.install-help');
  body.appendChild(el('p.muted.small', {
    text: installed
      ? 'این سایت از قبل روی صفحهٔ اصلی نصب شده است و از همان آیکون باز می‌شود.'
      : 'آیکون تیچ لینک روی صفحهٔ اصلی گوشی می‌ماند و با یک لمس باز می‌شود؛ دیگر لازم نیست آدرس سایت را تایپ کنید.',
  }));

  if (installed) {
    body.appendChild(el('p.small', { text: 'اگر آیکون را پیدا نمی‌کنید، در صفحهٔ برنامه‌ها یا پوشهٔ مرورگر گوشی بگردید.' }));
  } else if (ios) {
    body.appendChild(stepList([
      'سایت را در مرورگر Safari باز کنید؛ در آیفون و آیپد افزودن میانبر فقط از Safari ممکن است.',
      'دکمهٔ اشتراک‌گذاری را بزنید (مربع با فلش رو به بالا).',
      'در فهرست بازشده «افزودن به صفحهٔ اصلی» را انتخاب کنید.',
      'در گوشهٔ بالا روی «افزودن» بزنید.',
    ]));
  } else {
    body.appendChild(stepList([
      'منوی مرورگر را باز کنید (سه نقطهٔ بالا یا ⋮).',
      'گزینهٔ «نصب برنامه» یا «افزودن به صفحهٔ اصلی» را انتخاب کنید.',
      'در پنجرهٔ بازشده «نصب» یا «افزودن» را تأیید کنید.',
    ]));
    body.appendChild(el('p.small.muted', {
      text: 'اگر روی رایانه هستید، آیکون نصب در نوار آدرس یا منوی مرورگر هم همین کار را می‌کند.',
    }));
  }

  if (!installed) {
    body.appendChild(el('p.install-hint.small', {
      text: 'پس از افزودن، با همان حساب کاربری وارد می‌شوید و همهٔ داده‌های کلاس سر جای خودشان است.',
    }));
  }

  return openModal({
    title: '📲 افزودن به صفحهٔ اصلی گوشی',
    body,
    actions: [{ label: 'متوجه شدم', kind: 'ghost' }],
  });
}

/**
 * One click path shared by the settings card, the drawer and the login page:
 * use the native prompt when the browser offers it, otherwise show the steps.
 */
export async function startInstall() {
  const status = installSnapshot();
  if (status.installed) {
    notify.info('این سایت از قبل روی صفحهٔ اصلی نصب شده است');
    return { outcome: 'installed' };
  }
  if (!status.canPrompt) {
    openInstallDialog();
    return { outcome: 'unavailable' };
  }

  const { outcome } = await promptInstall();
  if (outcome === 'accepted') notify.ok('تیچ لینک به صفحهٔ اصلی گوشی اضافه شد');
  else if (outcome === 'dismissed') notify.info('افزودن به صفحهٔ اصلی لغو شد');
  else openInstallDialog();
  return { outcome };
}
