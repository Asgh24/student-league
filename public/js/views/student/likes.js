/** Student likes: encourage classmates, respecting the daily quota. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { emptyState, notify, openModal } from '../../ui.js';
import { button, card, chip, fa, faDateTime, grid, loadingNode, pageHead, statCard } from '../common.js';
import { studentTabs } from './tabs.js';

export async function renderStudentLikes() {
  setTopbarTitle('لایک و تشویق');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  async function load() {
    body.replaceChildren(loadingNode());
    let likes;
    let classmates;
    try {
      [likes, classmates] = await Promise.all([
        api.get('/student/likes'),
        api.get('/student/classmates'),
      ]);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت اطلاعات لایک ناموفق بود', hint: errorMessage(error) }));
      return;
    }

    async function sendLike(student) {
      const achievement = el('input', {
        type: 'text',
        placeholder: 'دلیل تشویق (اختیاری)',
        'aria-label': `دلیل تشویق ${student.name}`,
      });

      async function submit(close) {
        close();
        try {
          await api.post('/student/likes', { toStudentId: student.studentId, achievement: achievement.value.trim() });
          notify.ok(`برای ${student.name} لایک فرستاده شد`);
          await load();
        } catch (error) {
          notify.error(errorMessage(error));
        }
      }

      openModal({
        title: `تشویق ${student.name}`,
        body: el('div', {}, [
          el('p.small.muted', { text: 'برای دستاورد هم‌کلاسی خود یک پیام کوتاه بنویسید.' }),
          el('div.field', {}, [el('label', { text: 'دستاورد' }), achievement]),
        ]),
        actions: [
          { label: 'انصراف', kind: 'ghost', onClick: ({ close }) => close() },
          { label: 'ارسال لایک', onClick: ({ close }) => { void submit(close); } },
        ],
      });
    }

    const list = el('div');
    const others = (classmates.items ?? []).filter((item) => !item.isMe);
    if (others.length === 0) list.appendChild(el('p.muted.small', { text: 'هم‌کلاسی دیگری در لیگ نیست.' }));
    for (const student of others) {
      list.appendChild(el('div.row', { style: { justifyContent: 'space-between', borderBottom: '1px solid var(--line)', padding: '8px 0' } }, [
        el('div', {}, [
          el('strong', { text: student.name }),
          chip(`رتبه ${fa(student.rank)}`, 'muted'),
          chip(`${fa(student.total)} امتیاز`),
        ]),
        button('💜 لایک', { kind: 'soft', onClick: () => sendLike(student) }),
      ]));
    }

    function historyBlock(title, items, mapper, icon) {
      const block = el('div', { style: { marginTop: '10px' } });
      block.appendChild(el('h3', { text: title }));
      if ((items ?? []).length === 0) {
        block.appendChild(el('p.muted.small', { text: 'موردی ثبت نشده است.' }));
        return block;
      }
      for (const item of items) {
        block.appendChild(el('div.timeline-item', {}, [
          el('span.badge-emoji', { text: icon }),
          el('div', {}, [
            el('div', { text: mapper(item) }),
            el('div.small.muted', { text: `${item.achievement || 'بدون توضیح'} · ${faDateTime(item.createdAt)}` }),
          ]),
        ]));
      }
      return block;
    }

    body.replaceChildren(
      pageHead({ icon: '💜', title: 'لایک و تشویق', subtitle: 'دستاورد هم‌کلاسی‌هایت را تشویق کن' }),
      studentTabs('student/likes'),
      grid('grid--stats', [
        statCard({ label: 'لایک امروز', value: fa(likes.givenToday), icon: '📤' }),
        statCard({ label: 'سهمیه باقی‌مانده', value: fa(likes.remainingToday), icon: '🎫' }),
        statCard({ label: 'لایک دریافتی', value: fa(likes.receivedCount), icon: '📥' }),
      ]),
      card({ title: 'هم‌کلاسی‌ها', icon: '👥' }, [list]),
      grid('grid--two', [
        card({ title: 'لایک‌های ارسالی من', icon: '📤' }, [
          historyBlock('ارسال‌شده‌ها', likes.given, (item) => `برای ${item.toName}`, '💜'),
        ]),
        card({ title: 'لایک‌های دریافتی من', icon: '📥' }, [
          historyBlock('دریافت‌شده‌ها', likes.received, (item) => `از ${item.fromName}`, '🎉'),
        ]),
      ]),
      el('p.small.muted', { text: `سقف روزانه لایک: ${fa(likes.dailyLimit)}` }),
    );
  }

  await load();
  return undefined;
}
