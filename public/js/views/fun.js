/**
 * «سرگرمی» — an embedded neal.fun tab.
 *
 * Some sites refuse to render inside a frame (`X-Frame-Options`), and neal.fun
 * hides behind a Cloudflare challenge for non-browser clients. The page
 * therefore always offers a direct link and explains what to do when the frame
 * stays empty.
 */

import { el } from '../dom.js';
import { renderView, setTopbarTitle } from '../shell.js';
import { isStudent } from '../store.js';
import { button, card, pageHead } from './common.js';

const FUN_URL = 'https://neal.fun/';

export function renderFun() {
  setTopbarTitle('سرگرمی');
  const home = isStudent() ? 'student' : 'teacher';

  const frame = el('iframe.fun-frame', {
    src: FUN_URL,
    title: 'neal.fun — بازی‌ها و آزمایش‌های کوچک',
    allow: 'fullscreen',
    referrerpolicy: 'no-referrer',
    loading: 'lazy',
  });

  const fallback = el('div.fun-fallback', { hidden: true }, [
    el('span.fun-fallback__icon', { text: '🛰️', 'aria-hidden': 'true' }),
    el('p', { text: 'سایت داخل قاب بارگذاری نشد. برخی سایت‌ها نمایش در قاب را مسدود می‌کنند؛ از دکمهٔ «باز کردن در پنجرهٔ جدید» استفاده کنید.' }),
  ]);

  let loaded = false;
  frame.addEventListener('load', () => {
    loaded = true;
    fallback.hidden = true;
  });
  const timer = setTimeout(() => {
    if (!loaded) fallback.hidden = false;
  }, 6000);

  const openButton = el('a.btn.btn--soft', { href: FUN_URL, target: '_blank', rel: 'noopener noreferrer' }, [
    el('span', { text: '↗️', 'aria-hidden': 'true' }),
    el('span', { text: 'باز کردن در پنجرهٔ جدید' }),
  ]);

  const refresh = button('بارگذاری دوباره', {
    kind: 'ghost',
    icon: '🔄',
    onClick: () => {
      loaded = false;
      fallback.hidden = true;
      frame.src = FUN_URL;
    },
  });

  const node = el('div.fun-page', {}, [
    pageHead({
      icon: '🎮',
      title: 'سرگرمی',
      subtitle: 'neal.fun — مجموعه‌ای از بازی‌ها و آزمایش‌های تعاملی',
      actions: [
        openButton,
        refresh,
        el('a.btn.btn--ghost', { href: `#/${home}` , text: '↩️ بازگشت' }),
      ],
    }),
    card({ title: 'neal.fun', icon: '🌐' }, [
      el('p.small.muted', {
        text: 'اگر صفحه بالا نیامد، سایت اجازهٔ نمایش در قاب را نداده است؛ نسخهٔ کامل با دکمهٔ «باز کردن در پنجرهٔ جدید» باز می‌شود.',
      }),
      fallback,
      el('div.fun-frame-wrap', {}, [frame]),
    ]),
  ]);

  renderView([node]);
  void timer;
  return undefined;
}
