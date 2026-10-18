/** Team league: standings, member assignment and team point adjustments. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { confirmDialog, emptyState, formDialog, notify, openModal } from '../ui.js';
import { button, card, fa, grid, iconButton, loadingNode, pageHead } from './common.js';

function standingsTable(state, reload) {
  const { teams, individualAffectsTeam } = state;
  if (teams.length === 0) {
    return emptyState({ icon: '🛡️', title: 'هنوز تیمی ساخته نشده', hint: 'نخستین تیم را با دکمه «ساخت تیم» بسازید.' });
  }
  const table = el('table.grid-table');
  const head = el('tr', {}, [
    el('th', { text: '#' }),
    el('th', { text: 'تیم' }),
    el('th', { text: 'اعضا' }),
    el('th', { text: 'امتیاز مسابقات' }),
    individualAffectsTeam ? el('th', { text: 'میانگین اعضا' }) : null,
    el('th', { text: 'امتیاز نهایی' }),
    el('th', { text: 'عملیات' }),
  ]);
  table.appendChild(el('thead', {}, [head]));

  const tbody = el('tbody');
  for (const team of teams) {
    const members = el('div.row', { style: { gap: '4px', justifyContent: 'center' } });
    for (const member of team.members) {
      members.appendChild(el('span.chip', {}, [
        el('span', { text: member.name }),
        el('button.chip--button', {
          type: 'button',
          title: `حذف ${member.name} از تیم`,
          text: '✕',
          style: { border: '0', background: 'transparent', padding: '0 2px', cursor: 'pointer' },
          onclick: () => removeMember(member.studentId, reload),
        }),
      ]));
    }
    if (team.members.length === 0) members.appendChild(el('span.small.muted', { text: 'بدون عضو' }));

    tbody.appendChild(el(`tr${team.rank <= 3 ? `.rank-${team.rank}` : ''}`, {}, [
      el('td', { text: fa(team.rank) }),
      el('td.name-cell', {}, [
        el('strong', { text: team.name }),
        team.label ? el('span.chip.chip--amber', { text: team.label }) : null,
      ]),
      el('td', {}, [el('div', { text: `${fa(team.memberCount)} نفر` }), members]),
      el('td', { text: fa(team.basePoints) }),
      individualAffectsTeam ? el('td.delta-cell', { text: fa(team.memberAverage) }) : null,
      el('td.total-cell', { text: fa(team.finalPoints) }),
      el('td', {}, [
        el('span.row', { style: { justifyContent: 'center', gap: '3px' } }, [
          iconButton('±', { label: 'تنظیم دستی امتیاز', kind: 'soft', onClick: () => adjust(team, reload) }),
          iconButton('📜', { label: 'تاریخچه تعدیل‌ها', onClick: () => showHistory(team) }),
          iconButton('✏️', { label: 'ویرایش تیم', onClick: () => editTeam(team, reload) }),
          iconButton('✕', { label: 'حذف تیم', danger: true, onClick: () => removeTeam(team, reload) }),
        ]),
      ]),
    ]));
  }
  table.appendChild(tbody);
  return el('div.table-wrap', {}, [table]);
}

async function createTeam(leagueId, reload) {
  const values = await formDialog({
    title: 'ساخت تیم',
    submitLabel: 'ساخت تیم',
    fields: [
      { name: 'name', label: 'نام تیم', type: 'text', required: true, placeholder: 'مثلاً عقاب‌ها' },
      { name: 'label', label: 'نشان ویژه (اختیاری)', type: 'text', placeholder: 'مثلاً تیم قهرمان ماه' },
    ],
  });
  if (!values) return;
  try {
    await api.post(`/leagues/${leagueId}/teams`, { name: values.name.trim(), ...(values.label.trim() ? { label: values.label.trim() } : {}) });
    notify.ok('تیم ساخته شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function editTeam(team, reload) {
  const values = await formDialog({
    title: `ویرایش تیم ${team.name}`,
    submitLabel: 'ذخیره',
    fields: [
      { name: 'name', label: 'نام تیم', type: 'text', value: team.name, required: true },
      { name: 'label', label: 'نشان ویژه', type: 'text', value: team.label ?? '' },
    ],
  });
  if (!values) return;
  try {
    await api.patch(`/teams/${team.id}`, { name: values.name.trim(), label: values.label.trim() || null });
    notify.ok('تیم ذخیره شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function removeTeam(team, reload) {
  const agreed = await confirmDialog({
    title: 'حذف تیم',
    message: `تیم «${team.name}» حذف شود؟ اعضا به فهرست «بدون تیم» برمی‌گردند و امتیازهای مسابقات تیم از بین می‌رود.`,
    confirmLabel: 'حذف تیم',
    danger: true,
  });
  if (!agreed) return;
  try {
    await api.del(`/teams/${team.id}`);
    notify.ok('تیم حذف شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function adjust(team, reload) {
  const values = await formDialog({
    title: `تنظیم امتیاز تیم ${team.name}`,
    submitLabel: 'ثبت',
    fields: [
      { name: 'delta', label: 'مقدار تغییر (مثبت یا منفی)', type: 'number', value: 25, required: true },
      { name: 'reason', label: 'دلیل', type: 'text', placeholder: 'مثلاً برنده مسابقه کلاسی' },
    ],
  });
  if (!values) return;
  const delta = Number(values.delta);
  if (!Number.isFinite(delta) || delta === 0) {
    notify.error('مقدار تغییر باید عددی غیرصفر باشد');
    return;
  }
  try {
    await api.post(`/teams/${team.id}/adjust`, { delta: Math.trunc(delta), reason: values.reason.trim() });
    notify.ok('امتیاز تیم ثبت شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function showHistory(team) {
  try {
    const { items } = await api.get(`/teams/${team.id}/history`);
    const body = el('div');
    if (!items.length) body.appendChild(el('p.muted.small', { text: 'تعدیلی ثبت نشده است.' }));
    for (const item of items) {
      body.appendChild(el('div.timeline-item', {}, [
        el(`span.timeline-item__delta${item.delta < 0 ? '.is-negative' : '.is-positive'}`, { text: `${item.delta > 0 ? '+' : '−'}${fa(Math.abs(item.delta))}` }),
        el('div', {}, [
          el('div', { text: item.reason || 'بدون دلیل' }),
          el('div.small.muted', { text: item.actorName || 'معلم' }),
        ]),
      ]));
    }
    openModal({ title: `تاریخچه ${team.name}`, body });
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function assignStudent(leagueId, teamId, studentId, reload) {
  try {
    await api.post(`/leagues/${leagueId}/teams/assign`, { teamId, studentId });
    notify.ok('دانش‌آموز به تیم اضافه شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function removeMember(studentId, reload) {
  try {
    await api.del(`/leagues/${leagueIdHolder.value}/teams/members/${studentId}`);
    notify.ok('دانش‌آموز از تیم خارج شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

const leagueIdHolder = { value: null };

function unassignedPanel(state, reload) {
  const { unassigned, teams } = state;
  if (teams.length === 0) {
    return card({ title: 'دانش‌آموزان بدون تیم', icon: '👥' }, [
      el('p.small.muted', { text: 'برای تخصیص دانش‌آموزان، ابتدا یک تیم بسازید.' }),
    ]);
  }
  const select = el('select', { id: 'assign-target', 'aria-label': 'تیم هدف' });
  for (const team of teams) select.appendChild(el('option', { value: team.id, text: team.name }));

  const chips = el('div.row', { style: { gap: '6px' } });
  if (unassigned.length === 0) chips.appendChild(el('span.small.muted', { text: 'همه دانش‌آموزان در تیم‌ها قرار گرفته‌اند.' }));
  for (const student of unassigned) {
    chips.appendChild(el('button.chip.chip--button', {
      type: 'button',
      title: `${student.name} — ${fa(student.total)} امتیاز`,
      text: `➕ ${student.name}`,
      onclick: () => assignStudent(leagueIdHolder.value, Number(select.value), student.studentId, reload),
    }));
  }

  return card({ title: 'دانش‌آموزان بدون تیم', icon: '👥' }, [
    el('p.small.muted', { text: 'تیم مقصد را انتخاب کنید و سپس روی نام دانش‌آموز بزنید تا اضافه شود.' }),
    el('div.field', {}, [el('label', { for: 'assign-target', text: 'تیم مقصد' }), select]),
    chips,
  ]);
}

function affectsToggle(leagueId, state, reload) {
  const toggle = el('input', { id: 'team-affects', type: 'checkbox' });
  toggle.checked = Boolean(state.individualAffectsTeam);
  toggle.addEventListener('change', async () => {
    try {
      await api.put(`/leagues/${leagueId}/settings`, { individualAffectsTeam: toggle.checked });
      notify.ok(toggle.checked ? 'امتیاز انفرادی روی تیم اثر می‌گذارد' : 'فقط امتیاز مسابقات تیم محاسبه می‌شود');
      reload();
    } catch (error) {
      toggle.checked = !toggle.checked;
      notify.error(errorMessage(error));
    }
  });
  return card({ title: 'قانون امتیازدهی تیمی', icon: '🎛️' }, [
    el('label.checkbox', { for: 'team-affects' }, [toggle, el('span', { text: 'امتیاز انفرادی دانش‌آموزان روی امتیاز تیم اثر بگذارد' })]),
    el('p.small.muted', {
      text: state.individualAffectsTeam
        ? 'امتیاز نهایی تیم = امتیاز مسابقات تیم + میانگین امتیاز اعضا.'
        : 'امتیاز نهایی تیم فقط از امتیاز مسابقات تیمی محاسبه می‌شود.',
    }),
  ]);
}

export async function renderTeams({ params }) {
  const leagueId = Number(params.id);
  leagueIdHolder.value = leagueId;
  setLeagueId(leagueId);
  setTopbarTitle('لیگ تیمی');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  async function load() {
    body.replaceChildren(loadingNode());
    let league;
    let data;
    try {
      [league, data] = await Promise.all([api.get(`/leagues/${leagueId}`), api.get(`/leagues/${leagueId}/teams`)]);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت اطلاعات تیم‌ها ناموفق بود', hint: errorMessage(error) }));
      return;
    }
    setLeaguePill({ name: league.league.name });

    body.replaceChildren(
      pageHead({
        icon: '🛡️',
        title: 'لیگ تیمی',
        subtitle: league.league.name,
        actions: [
          button('ساخت تیم', { icon: '➕', onClick: () => createTeam(leagueId, load) }),
          el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '📋 جدول امتیازها' }),
        ],
      }),
      grid('grid--two', [
        affectsToggle(leagueId, data, load),
        card({ title: 'راهنما', icon: '💡' }, [
          el('p.small.muted', { text: 'امتیاز مسابقات تیمی را با دکمه ± وارد کنید. میانگین اعضا از جدول امتیازهای انفرادی خوانده می‌شود.' }),
          el('p.small.muted', { text: `تیم‌ها: ${fa(data.teams.length)} | بدون تیم: ${fa(data.unassigned.length)}` }),
        ]),
      ]),
      card({ title: 'رده‌بندی تیم‌ها', icon: '🏅' }, [standingsTable(data, load)]),
      unassignedPanel(data, load),
    );
  }

  await load();
  return undefined;
}
