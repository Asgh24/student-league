/** Student team view: own team, its members and the team standing. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { emptyState } from '../../ui.js';
import { card, chip, fa, grid, loadingNode, pageHead, statCard } from '../common.js';
import { studentTabs } from './tabs.js';

export async function renderStudentTeam() {
  setTopbarTitle('تیم من');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let data;
  try {
    data = await api.get('/student/team');
  } catch (error) {
    body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت اطلاعات تیم ناموفق بود', hint: errorMessage(error) }));
    return undefined;
  }

  if (!data.team) {
    body.replaceChildren(
      pageHead({ icon: '🛡️', title: 'تیم من' }),
      studentTabs('student/team'),
      card({ title: 'تیم من', icon: '🛡️' }, [
        emptyState({ icon: '🛡️', title: 'هنوز در تیمی قرار نگرفته‌اید', hint: 'معلم شما می‌تواند اعضای تیم‌ها را مشخص کند.' }),
      ]),
    );
    return undefined;
  }

  const members = el('div');
  for (const member of data.members) {
    members.appendChild(el('div.timeline-item', {}, [
      el('span.badge-emoji', { text: '🧑‍🎓' }),
      el('div', { text: member.name }),
    ]));
  }

  body.replaceChildren(
    pageHead({ icon: '🛡️', title: 'تیم من', subtitle: data.team.name }),
    studentTabs('student/team'),
    grid('grid--stats', [
      statCard({ label: 'امتیاز نهایی تیم', value: fa(data.team.finalPoints), icon: '🏆' }),
      statCard({ label: 'امتیاز مسابقات تیم', value: fa(data.team.basePoints), icon: '⚔️' }),
      statCard({ label: 'رتبه تیم', value: `${fa(data.rank ?? 0)} از ${fa(data.totalTeams ?? 0)}`, icon: '🥇' }),
    ]),
    grid('grid--two', [
      card({ title: 'مشخصات تیم', icon: '📋' }, [
        el('p', {}, [el('strong', { text: 'نام تیم: ' }), el('span', { text: data.team.name })]),
        data.team.label ? el('p', {}, [el('strong', { text: 'نشان ویژه: ' }), chip(data.team.label, 'amber')]) : null,
        el('p', {}, [el('strong', { text: 'تعداد اعضا: ' }), el('span', { text: fa(data.members.length) })]),
        el('p', {}, [el('strong', { text: 'میانگین امتیاز اعضا: ' }), el('span', { text: fa(data.team.memberAverage) })]),
      ]),
      card({ title: `اعضای تیم (${fa(data.members.length)})`, icon: '👥' }, [
        data.members.length ? members : el('p.muted.small', { text: 'عضوی ثبت نشده است.' }),
      ]),
    ]),
  );
  return undefined;
}
