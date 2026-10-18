/** Student dashboard: greeting, headline stats, progress chart and medals. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderPointsChart } from '../../charts.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../../shell.js';
import { state } from '../../store.js';
import { emptyState } from '../../ui.js';
import { card, chip, fa, faDateTime, grid, loadingNode, pageHead, statCard } from '../common.js';
import { studentTabs } from './tabs.js';

function firstName(full) {
  return String(full ?? '').trim().split(/\s+/)[0] || 'دوست من';
}

function medalsSection(data) {
  if (!data.medals || data.medals.length === 0) {
    return card({ title: 'مدال‌ها و عنوان‌ها', icon: '🏅' }, [
      emptyState({ icon: '🏅', title: 'هنوز مدالی نگرفته‌اید', hint: 'با تلاش در لیگ، عنوان و مدال به دست آورید.' }),
    ]);
  }
  const list = el('div');
  for (const medal of data.medals) {
    list.appendChild(el('div.timeline-item', {}, [
      el('span.badge-emoji', { text: medal.rank === 1 ? '🥇' : medal.rank === 2 ? '🥈' : '🥉' }),
      el('div', {}, [
        el('div', {}, [el('strong', { text: medal.title }), chip(medal.source === 'league_completed' ? 'پایان لیگ' : 'دستی', 'muted')]),
        el('div.small.muted', { text: faDateTime(medal.createdAt) }),
      ]),
    ]));
  }
  return card({ title: 'مدال‌ها و عنوان‌ها', icon: '🏅' }, [list]);
}

export async function renderStudentDashboard() {
  setTopbarTitle('میزکار دانش‌آموز');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let data;
  try {
    data = await api.get('/student/dashboard');
  } catch (error) {
    body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت اطلاعات ناموفق بود', hint: errorMessage(error) }));
    return undefined;
  }

  setLeaguePill({ name: data.leagueName });
  const canvas = el('canvas', { 'aria-label': 'نمودار روند امتیاز من' });
  const hasSeries = (data.series?.points?.length ?? 0) > 0;

  body.replaceChildren(
    pageHead({
      icon: '👋',
      title: `سلام ${firstName(data.name)}!`,
      subtitle: `${data.leagueName} · ${data.leagueStatus === 'completed' ? 'لیگ پایان‌یافته' : 'لیگ فعال'}`,
    }),
    studentTabs('student'),
    grid('grid--stats', [
      statCard({ label: 'امتیاز من', value: fa(data.points), icon: '⭐' }),
      statCard({ label: 'رتبه من', value: `${fa(data.rank ?? 0)} از ${fa(data.totalStudents ?? 0)}`, icon: '🏆' }),
      statCard({ label: 'قهرمانی‌ها', value: fa(data.championships ?? 0), icon: '🥇' }),
    ]),
    grid('grid--two', [
      card({ title: 'عنوان و تیم من', icon: '🎖️' }, [
        el('p', {}, [
          el('strong', { text: 'عنوان فعلی: ' }),
          el('span', { text: `${data.title?.icon ?? ''} ${data.title?.title ?? ''}` }),
        ]),
        data.team
          ? el('p', {}, [
            el('strong', { text: 'تیم: ' }),
            el('span', { text: `${data.team.name} (رتبه ${fa(data.team.rank)} · ${fa(data.team.members)} عضو)` }),
          ])
          : el('p.muted.small', { text: 'هنوز در تیمی قرار نگرفته‌اید.' }),
        el('p.small.muted', { text: `آخرین امتیاز ثبت‌شده را می‌توانید در بخش تاریخچه ببینید.` }),
      ]),
      medalsSection(data),
    ]),
    card({ title: 'روند امتیاز من', icon: '📈' }, [
      hasSeries
        ? el('div.chart-box', {}, [canvas])
        : emptyState({ icon: '📈', title: 'هنوز امتیازی ثبت نشده است', hint: 'به‌محض ثبت اولین امتیاز، نمودار روند شما نمایش داده می‌شود.' }),
      el('p.small.muted', { text: 'نقطه‌های سبز افزایش، نقطه‌های قرمز کاهش و نقطه‌های آبی شروع و وضعیت فعلی هستند.' }),
    ]),
  );

  if (hasSeries) {
    renderPointsChart(canvas, data.series, { persianDigits: state.persianDigits });
  }
  return undefined;
}
