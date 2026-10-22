/** Admin: GitHub backups, local download and staged restore. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { confirmDialog, emptyState, notify } from '../../ui.js';
import { button, card, chip, fa, faDateTime, loadingNode, pageHead } from '../common.js';
import { adminEmpty, adminTabs } from './common.js';

function bytesLabel(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${fa(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${fa((bytes / 1024).toFixed(1))} کیلوبایت`;
  return `${fa((bytes / 1024 / 1024).toFixed(1))} مگابایت`;
}

function infoRow(label, value) {
  return el('div.row', {}, [
    el('span.small.muted', { text: label }),
    el('span.spacer'),
    el('strong.small', { text: value ?? '—' }),
  ]);
}

function statusCard(payload, actions) {
  const remote = payload.remote ?? {};
  const pending = Boolean(payload.pendingRestore);
  return card({ title: 'وضعیت بکاپ', icon: '🗄️' }, [
    el('div.row', {}, [
      chip(payload.configured ? 'گیت‌هاب متصل است' : 'گیت‌هاب تنظیم نشده', payload.configured ? 'ok' : 'bad'),
      chip(payload.enabled ? 'بکاپ خودکار فعال' : 'بکاپ خودکار خاموش', payload.enabled ? 'ok' : 'muted'),
      chip(payload.restoreOnEmpty ? 'بازیابی خودکار دیتای خالی' : 'بازیابی خودکار خاموش', payload.restoreOnEmpty ? 'ok' : 'muted'),
      pending ? chip('بازیابی در انتظار ری‌استارت', 'amber') : null,
    ].filter(Boolean)),
    !payload.configured
      ? el('div.demo-banner.demo-banner--warn', { role: 'status' }, [
        el('strong', { text: 'بکاپ گیت‌هاب هنوز تنظیم نشده است' }),
        el('p.small', {
          text: `برای فعال‌شدن، این متغیرها را در محیط سرور تنظیم کنید: ${(payload.missing ?? []).join('، ')}`,
        }),
        el('p.small.muted', {
          text: 'مخزن باید خصوصی باشد؛ بکاپ شامل نام دانش‌آموزان و نمرات است.',
        }),
      ])
      : null,
    remote.error
      ? el('div.demo-banner.demo-banner--warn', { role: 'status' }, [
        el('strong', { text: 'ارتباط با گیت‌هاب ناموفق بود' }),
        el('p.small', { text: remote.error }),
      ])
      : null,
    el('div.grid.grid--two', {}, [
      el('div', {}, [
        infoRow('مخزن', payload.repo || '—'),
        infoRow('شاخه', payload.branch || '—'),
        infoRow('پوشه', payload.dir || '—'),
        infoRow('تعداد بکاپ‌های گیت‌هاب', fa(remote.count ?? 0)),
      ]),
      el('div', {}, [
        infoRow('آخرین بکاپ موفق', payload.scheduler?.lastSuccessAt ? faDateTime(payload.scheduler.lastSuccessAt) : '—'),
        infoRow('فایل آخرین بکاپ', payload.scheduler?.lastFile || remote.manifest?.file || '—'),
        infoRow('حجم دیتابیس محلی', bytesLabel(payload.local?.dbBytes)),
        infoRow('فایل‌های آپلودی (خارج از بکاپ)', `${fa(payload.local?.uploadsFiles ?? 0)} فایل · ${bytesLabel(payload.local?.uploadsBytes)}`),
      ]),
    ]),
    payload.scheduler?.lastError
      ? el('p.small', { text: `آخرین خطای بکاپ خودکار: ${payload.scheduler.lastError}` })
      : null,
    el('div.row', {}, actions),
  ]);
}

function pendingCard(payload, onCancel) {
  const pending = payload.pendingRestore;
  if (!pending) return null;
  return card({ title: 'بازیابی در انتظار اعمال', icon: '⏳' }, [
    el('p.small', {
      text: `فایل «${pending.sourceFile || '—'}» دانلود و آماده شده است. با ری‌استارت سرویس، این بکاپ جایگزین دیتابیس فعلی می‌شود.`,
    }),
    el('p.small.muted', { text: `زمان آماده‌سازی: ${pending.requestedAt ? faDateTime(pending.requestedAt) : '—'}` }),
    button('لغو بازیابی در انتظار', { kind: 'danger', icon: '✖️', onClick: onCancel }),
  ]);
}

function snapshotsCard(payload, onRestore) {
  const snapshots = payload.remote?.snapshots ?? [];
  return card({ title: 'بکاپ‌های موجود در گیت‌هاب', icon: '📦' }, [
    snapshots.length === 0
      ? adminEmpty('هنوز بکاپی در گیت‌هاب وجود ندارد', 'با دکمهٔ «بکاپ همین حالا» اولین نسخه را بسازید.')
      : el('div.admin-list', {}, snapshots.map((snapshot) => el('div.admin-row', {}, [
        el('div.admin-row__main', {}, [
          el('div.row', {}, [
            el('strong', { text: snapshot.name }),
            chip(bytesLabel(snapshot.size), 'muted'),
          ]),
          el('p.small.muted', { text: 'برای بازیابی، ابتدا بکاپ در سرور آماده می‌شود و سپس باید سرویس را ری‌استارت کنید.' }),
        ]),
        button('بازیابی این نسخه', {
          kind: 'soft',
          icon: '♻️',
          onClick: () => onRestore(snapshot.name),
        }),
      ]))),
  ]);
}

export async function renderAdminBackup() {
  setTopbarTitle('بکاپ و بازیابی');
  const body = el('div', {}, [loadingNode()]);
  renderView(el('div', {}, [
    pageHead({
      icon: '🗄️',
      title: 'بکاپ و بازیابی',
      subtitle: 'بکاپ دستی روی گیت‌هاب، دانلود نسخهٔ محلی و بازیابی امن با ری‌استارت',
    }),
    adminTabs('admin/backup'),
    body,
  ]));

  async function backupNow() {
    try {
      const result = await api.post('/admin/backup/run', {});
      notify.ok(`بکاپ «${result.backup?.file || ''}» روی گیت‌هاب ذخیره شد`);
      await load();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function restore(file = null) {
    const label = file ? `نسخهٔ «${file}»` : 'آخرین بکاپ گیت‌هاب';
    const ok = await confirmDialog({
      title: 'بازیابی بکاپ',
      message: `${label} دانلود و برای جایگزینی دیتابیس آماده می‌شود. دیتابیس فعلی پس از ری‌استارت سرویس جایگزین می‌شود. ادامه می‌دهید؟`,
      confirmLabel: 'آماده‌سازی بازیابی',
      danger: true,
    });
    if (!ok) return;
    try {
      const result = await api.post('/admin/backup/restore', file ? { file } : {});
      notify.warn(result.message || 'بکاپ آماده شد؛ سرویس را ری‌استارت کنید');
      await load();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function cancelPending() {
    try {
      const result = await api.del('/admin/backup/restore');
      notify.ok(result.message || 'بازیابی در انتظار لغو شد');
      await load();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function load() {
    body.replaceChildren(loadingNode());
    let payload;
    try {
      payload = await api.get('/admin/backup');
    } catch (error) {
      body.replaceChildren(emptyState({
        icon: '⚠️',
        title: 'دریافت وضعیت بکاپ ناموفق بود',
        hint: errorMessage(error),
      }));
      return;
    }

    const configured = Boolean(payload.configured);
    const actions = [
      button('بکاپ همین حالا', {
        icon: '⬆️',
        kind: 'primary',
        disabled: !configured,
        onClick: backupNow,
      }),
      el('a.btn.btn--soft', {
        href: '/api/v1/admin/backup/download',
        download: 'league-backup.db',
      }, [el('span', { text: '⬇️', 'aria-hidden': 'true' }), el('span', { text: 'دانلود بکاپ محلی' })]),
      button('بازیابی آخرین بکاپ', {
        icon: '♻️',
        kind: 'soft',
        disabled: !configured,
        onClick: () => restore(),
      }),
    ];

    body.replaceChildren(...[
      statusCard(payload, actions),
      pendingCard(payload, cancelPending),
      snapshotsCard(payload, restore),
      card({ title: 'نکته‌های مهم', icon: '💡' }, [
        el('ul.small', {}, [
          el('li', { text: 'بکاپ گیت‌هاب از کل دیتابیس SQLite گرفته می‌شود؛ نام دانش‌آموزان، نمرات، حضور و غیاب، تنظیمات و کلیدهای رمزنگاری‌شدهٔ پیامک/Groq داخل آن هستند.' }),
          el('li', { text: 'کلیدهای پیامک و Groq فقط وقتی قابل بازگشایی‌اند که مقدار SECRETS_KEY در سرور ثابت بماند. این مقدار را بعد از اولین استقرار تغییر ندهید.' }),
          el('li', { text: 'فایل‌های آپلودی و تصاویر رسید در پوشهٔ uploads هستند و در بکاپ گیت‌هاب قرار نمی‌گیرند؛ برای آن‌ها از بکاپ حجم ذخیره‌سازی هاست استفاده کنید.' }),
          el('li', { text: 'بازیابی در پنل فقط بکاپ را آماده می‌کند. برای اعمال، سرویس را از پنل هاست یا با systemctl/pm2 یک‌بار ری‌استارت کنید.' }),
        ]),
      ]),
    ].filter(Boolean));
  }

  await load();
}
