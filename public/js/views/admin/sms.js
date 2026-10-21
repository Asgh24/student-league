/** Full sms.ir console: configuration, credit, bulk/test send and outbox. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { emptyState, notify } from '../../ui.js';
import { button, card, fa, faDateTime, field, pageHead, statCard } from '../common.js';
import { adminTabs, statusChip } from './common.js';

function outboxRow(message, onRetry) {
  return el('div.admin-row', {}, [
    el('div.admin-row__main', {}, [
      el('div.row', {}, [
        el('strong', { text: message.studentName || message.leagueName || 'گزارش' }),
        statusChip(message.status),
        el('span.chip.chip--muted', { text: message.teacherName || '—' }),
      ]),
      el('p.small', { text: message.body }),
      el('p.small.muted', {
        text: `${message.mobile} · ${faDateTime(message.createdAt)}${message.error ? ` · ${message.error}` : ''}`,
      }),
    ]),
    message.status !== 'sent'
      ? button('تلاش دوباره', { kind: 'soft', icon: '🔁', onClick: () => onRetry(message.id) })
      : el('span.chip.chip--ok', { text: 'ارسال شد' }),
  ]);
}

function campaignRow(message, onRetry) {
  return el('div.admin-row', {}, [
    el('div.admin-row__main', {}, [
      el('div.row', {}, [
        el('strong', { text: message.kind === 'test' ? 'پیام آزمایشی' : 'ارسال انبوه' }),
        statusChip(message.status),
        el('span.chip.chip--muted', { text: message.mobile }),
      ]),
      el('p.small', { text: message.body }),
      el('p.small.muted', { text: `${faDateTime(message.createdAt)}${message.error ? ` · ${message.error}` : ''}` }),
    ]),
    message.status !== 'sent'
      ? button('تلاش دوباره', { kind: 'soft', icon: '🔁', onClick: () => onRetry(message.id) })
      : el('span.chip.chip--ok', { text: 'ارسال شد' }),
  ]);
}

export async function renderAdminSms() {
  setTopbarTitle('پنل پیامک');
  const body = el('div');
  const feedback = el('div.panel-feedback', { role: 'status' });
  let statusFilter = '';
  renderView([
    pageHead({ icon: '📨', title: 'پنل پیامک sms.ir', subtitle: 'اعتبار، ارسال تست، ارسال انبوه و صندوق خروجی' }),
    adminTabs('admin/sms'),
    feedback,
    body,
  ]);

  async function load() {
    body.replaceChildren(el('div.empty', {}, [el('span.empty__icon', { text: '⏳' }), el('p', { text: 'در حال دریافت وضعیت پیامک…' })]));
    let payload;
    try {
      payload = await api.get(`/admin/sms${statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''}`);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت پنل پیامک ناموفق بود', hint: errorMessage(error) }));
      return;
    }

    const config = payload.config ?? {};
    const counts = payload.counts ?? { outbox: {}, campaigns: {} };

    async function credit() {
      feedback.textContent = '';
      try {
        const result = await api.get('/admin/sms/credit');
        if (result.ok) {
          feedback.replaceChildren(el('p.small', { text: `اعتبار فعلی: ${fa(result.credit)} ریال` }));
          notify.ok('اعتبار دریافت شد');
        } else {
          feedback.replaceChildren(el('p.small.muted', { text: result.message || 'دریافت اعتبار ممکن نشد' }));
        }
      } catch (error) {
        notify.error(errorMessage(error));
      }
    }

    async function lines() {
      feedback.textContent = '';
      try {
        const result = await api.get('/admin/sms/lines');
        if (result.ok) {
          feedback.replaceChildren(el('p.small', { text: `خطوط: ${(result.lines ?? []).map((line) => line.lineNumber ?? line.number ?? line).join('، ') || 'خطی یافت نشد'}` }));
        } else {
          feedback.replaceChildren(el('p.small.muted', { text: result.message || 'دریافت خطوط ممکن نشد' }));
        }
      } catch (error) {
        notify.error(errorMessage(error));
      }
    }

    async function retryMessage(id) {
      try {
        await api.post(`/admin/sms/messages/${id}/retry`, {});
        notify.ok('تلاش دوباره انجام شد');
        await load();
      } catch (error) {
        notify.error(errorMessage(error));
      }
    }

    async function retryCampaign(id) {
      try {
        await api.post(`/admin/sms/campaigns/${id}/retry`, {});
        notify.ok('تلاش دوباره انجام شد');
        await load();
      } catch (error) {
        notify.error(errorMessage(error));
      }
    }

    const testMobile = el('input', { id: 'sms-test-mobile', type: 'tel', placeholder: '09121234567' });
    const testMessage = el('input', { id: 'sms-test-message', type: 'text', placeholder: 'متن پیام آزمایشی' });
    const testForm = el('form', { novalidate: 'true' }, [
      el('div.grid.grid--two', {}, [field('شمارهٔ موبایل', testMobile), field('متن پیامک', testMessage)]),
      button('ارسال پیام آزمایشی', { icon: '📤', type: 'submit' }),
    ]);
    testForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!testMobile.value.trim() || !testMessage.value.trim()) {
        notify.error('شماره و متن پیامک را وارد کنید');
        return;
      }
      try {
        const result = await api.post('/admin/sms/test', {
          mobile: testMobile.value.trim(),
          message: testMessage.value.trim(),
        });
        notify.ok(result.item?.status === 'sent' ? 'پیام آزمایشی ارسال شد' : 'پیام در صف ذخیره شد');
        testMessage.value = '';
        await load();
      } catch (error) {
        notify.error(errorMessage(error));
      }
    });

    const bulkMobiles = el('textarea', { id: 'sms-bulk-mobiles', rows: '4', placeholder: 'هر شماره در یک خط یا جدا‌شده با کاما (حداکثر ۱۰۰ شماره)' });
    const bulkMessage = el('textarea', { id: 'sms-bulk-message', rows: '3', placeholder: 'متن پیامک' });
    const bulkForm = el('form', { novalidate: 'true' }, [
      field('شماره‌ها', bulkMobiles, 'شماره‌ها به شکل خودکار به قالب 09xxxxxxxxx تبدیل می‌شوند.'),
      field('متن پیامک', bulkMessage),
      button('ارسال انبوه', { icon: '📨', type: 'submit' }),
    ]);
    bulkForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const mobiles = bulkMobiles.value.split(/[\s,;،]+/).map((value) => value.trim()).filter(Boolean);
      if (mobiles.length === 0 || !bulkMessage.value.trim()) {
        notify.error('حداقل یک شماره و متن پیامک لازم است');
        return;
      }
      try {
        const result = await api.post('/admin/sms/bulk', { mobiles, message: bulkMessage.value.trim() });
        notify.ok(result.status === 'sent' ? `${fa(result.count)} پیام ارسال شد` : `${fa(result.count)} پیام در صف ذخیره شد`);
        bulkMessage.value = '';
        await load();
      } catch (error) {
        notify.error(errorMessage(error));
      }
    });

    const filterSelect = el('select', { id: 'sms-filter' }, [
      el('option', { value: '', text: 'همه', selected: statusFilter === '' }),
      el('option', { value: 'queued', text: 'در صف', selected: statusFilter === 'queued' }),
      el('option', { value: 'sent', text: 'ارسال‌شده', selected: statusFilter === 'sent' }),
      el('option', { value: 'failed', text: 'ناموفق', selected: statusFilter === 'failed' }),
    ]);
    filterSelect.addEventListener('change', () => {
      statusFilter = filterSelect.value;
      void load();
    });

    body.replaceChildren(
      card({ title: 'وضعیت اتصال', icon: '🔌' }, [
        el('div.row', {}, [
          el(`span.chip.chip--${config.configured ? 'ok' : 'amber'}`, { text: config.configured ? 'sms.ir متصل است' : 'پیکربندی نشده' }),
          el('span.chip.chip--muted', { text: `خط: ${config.lineNumber || '—'}` }),
          el('span.chip.chip--muted', { text: `کلید API: ${config.hasApiKey ? 'ثبت‌شده' : 'ثبت‌نشده'}` }),
        ]),
        !config.configured
          ? el('div.demo-banner.demo-banner--warn', {}, [
            el('strong', { text: 'برای ارسال واقعی، حساب sms.ir لازم است' }),
            el('p.small', { text: 'مدیر سرور باید SMSIR_API_KEY و SMSIR_LINE_NUMBER را در فایل محیطی وارد کند. تا آن زمان پیام‌ها در صف می‌مانند و از بین نمی‌روند.' }),
          ])
          : null,
        el('div.row', {}, [
          button('دریافت اعتبار', { kind: 'soft', icon: '💰', onClick: credit }),
          button('دریافت خطوط', { kind: 'ghost', icon: '📞', onClick: lines }),
        ]),
      ]),
      card({ title: 'خلاصه', icon: '📊' }, [
        el('div.grid.grid--stats', {}, [
          statCard({ label: 'گزارش در صف', value: fa(counts.outbox?.queued ?? 0), kind: 'warn', icon: '⏳' }),
          statCard({ label: 'گزارش ارسال‌شده', value: fa(counts.outbox?.sent ?? 0), kind: 'ok', icon: '✅' }),
          statCard({ label: 'گزارش ناموفق', value: fa(counts.outbox?.failed ?? 0), kind: 'bad', icon: '❌' }),
          statCard({ label: 'کمپین در صف', value: fa(counts.campaigns?.queued ?? 0), kind: 'warn', icon: '📨' }),
          statCard({ label: 'کمپین ارسال‌شده', value: fa(counts.campaigns?.sent ?? 0), kind: 'ok', icon: '📤' }),
        ]),
      ]),
      el('div.grid.grid--two', {}, [
        card({ title: 'ارسال پیام آزمایشی', icon: '🧪' }, [testForm]),
        card({ title: 'ارسال انبوه', icon: '📨' }, [bulkForm]),
      ]),
      card({
        title: 'صندوق گزارش‌های لیگ',
        icon: '📥',
        actions: [filterSelect],
      }, [
        payload.outbox?.length
          ? el('div.admin-list', {}, payload.outbox.map((message) => outboxRow(message, retryMessage)))
          : emptyState({ icon: '📥', title: 'گزارشی در صندوق نیست' }),
      ]),
      card({ title: 'کمپین‌های مدیر', icon: '🗂️' }, [
        payload.campaigns?.length
          ? el('div.admin-list', {}, payload.campaigns.map((message) => campaignRow(message, retryCampaign)))
          : emptyState({ icon: '🗂️', title: 'کمپینی ارسال نشده است' }),
      ]),
    );
  }

  await load();
  return undefined;
}
