/** Admin: permanently remove teachers whose trial/subscription has ended. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { bytes, errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { emptyState, formDialog, notify } from '../../ui.js';
import { button, card, fa, faDate, faDateTime, pageHead } from '../common.js';
import { adminTabs } from './common.js';

function accessEnd(teacher) {
  return teacher.subscription?.endsAt
    ?? teacher.subscriptionEndsAt
    ?? teacher.trialEndsAt
    ?? null;
}

function expiredCard(teacher, onDelete) {
  const endedAt = accessEnd(teacher);
  const storage = teacher.storage ?? {};
  return el('div.admin-row', {}, [
    el('div.admin-row__main', {}, [
      el('div.row', {}, [
        el('strong', { text: teacher.displayName }),
        el('span.chip.chip--bad', { text: 'اشتراک منقضی' }),
        el('span.small.muted', { text: `@${teacher.username}` }),
      ]),
      el('p.small.muted', {
        text: `${fa(teacher.leagueCount ?? 0)} لیگ · ${fa(teacher.studentCount ?? 0)} دانش‌آموز · ${fa(teacher.fileCount ?? 0)} فایل (${bytes(storage.usedBytes ?? 0)})`,
      }),
      el('p.small.muted', {
        text: [
          endedAt ? `پایان دسترسی: ${faDate(endedAt)}` : null,
          teacher.lastPaidAt ? `آخرین پرداخت: ${faDateTime(teacher.lastPaidAt)}` : 'بدون پرداخت',
        ].filter(Boolean).join(' · '),
      }),
    ]),
    el('div.admin-row__actions', {}, [
      button('حذف حساب', { kind: 'danger', icon: '🗑️', onClick: () => onDelete(teacher) }),
    ]),
  ]);
}

async function confirmDelete(teacher, reload) {
  const values = await formDialog({
    title: `حذف قطعی حساب ${teacher.displayName}`,
    description: 'تمام لیگ‌ها، دانش‌آموزان، نمرات، فایل‌های ذخیره‌شده و سوابق پرداخت این معلم پاک می‌شوند. این عملیات قابل بازگشت نیست.',
    submitLabel: 'حذف قطعی',
    fields: [
      {
        name: 'confirmUsername',
        label: `برای تأیید، نام کاربری «${teacher.username}» را وارد کنید`,
        required: true,
        placeholder: teacher.username,
        autocomplete: 'off',
      },
    ],
  });
  if (!values) return;

  if (values.confirmUsername.trim().toLowerCase() !== String(teacher.username).toLowerCase()) {
    notify.error('نام کاربری وارد‌شده با نام کاربری این معلم مطابقت ندارد');
    return;
  }

  try {
    const result = await api.del(`/admin/teachers/${teacher.id}`, {
      confirmUsername: values.confirmUsername.trim(),
    });
    const deleted = result?.deleted ?? {};
    notify.ok(`حساب «${teacher.displayName}» و ${fa(deleted.files ?? 0)} فایل آن حذف شد`);
    await reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

export async function renderAdminExpiredUsers() {
  setTopbarTitle('حذف کاربران منقضی');
  const body = el('div');
  renderView([
    pageHead({
      icon: '🗑️',
      title: 'حذف کاربران منقضی',
      subtitle: 'پاک‌سازی دستی معلمانی که دورهٔ آزمایشی و اشتراکشان تمام شده است',
    }),
    adminTabs('admin/expired-users'),
    body,
  ]);

  async function load() {
    body.replaceChildren(el('div.empty', {}, [el('span.empty__icon', { text: '⏳' }), el('p', { text: 'در حال دریافت کاربران منقضی…' })]));
    let payload;
    try {
      payload = await api.get('/admin/expired-users');
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت کاربران منقضی ناموفق بود', hint: errorMessage(error) }));
      return;
    }

    const items = payload.items ?? [];
    body.replaceChildren(
      card({ title: 'حذف دستی کاربران بدون اشتراک', icon: '⚠️' }, [
        el('p.small.muted', {
          text: 'فقط معلمانی که دسترسی آن‌ها کاملاً تمام شده در این فهرست هستند. معلمان فعال، در دورهٔ آزمایشی یا دارای دسترسی نامحدود قابل حذف نیستند.',
        }),
        el('div.demo-banner.demo-banner--warn', { role: 'status' }, [
          el('strong', { text: 'حذف حساب دائمی است' }),
          el('p.small', {
            text: 'با حذف هر معلم، لیگ‌ها، دانش‌آموزان، امتیازها، فایل‌های آپلودی و سوابق پرداخت او نیز از سامانه پاک می‌شود.',
          }),
        ]),
      ]),
      card({ title: `کاربران منقضی (${fa(payload.total ?? 0)})`, icon: '📋' }, [
        items.length
          ? el('div.admin-list', {}, items.map((teacher) => expiredCard(teacher, (item) => confirmDelete(item, load))))
          : emptyState({
            icon: '✅',
            title: 'کاربر منقضی‌ای برای حذف وجود ندارد',
            hint: 'همهٔ معلمان یا اشتراک فعال دارند یا قبلاً حذف شده‌اند.',
          }),
      ]),
    );
  }

  await load();
  return undefined;
}
