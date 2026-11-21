/** Teacher-wide student roster and league-to-league transfer workflow. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId, state } from '../store.js';
import { confirmDialog, emptyState, notify } from '../ui.js';
import { backToWorkbench, button, card, chip, fa, loadingNode, pageHead, tableWrap } from './common.js';

function option(select, league, suffix = '') {
  select.appendChild(el('option', {
    value: league.id,
    text: `${league.name} · ${fa(league.studentCount)} دانش‌آموز${suffix}`,
  }));
}

function latestMembership(profile) {
  return profile.memberships.find((membership) => membership.currentLogin)
    ?? profile.memberships.find((membership) => membership.leagueStatus === 'active')
    ?? profile.memberships[0]
    ?? null;
}

function rosterTable(items) {
  const table = el('table.grid-table');
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { text: 'دانش‌آموز' }),
    el('th', { text: 'حساب ورود' }),
    el('th', { text: 'شماره والد' }),
    el('th', { text: 'لیگ فعلی' }),
    el('th', { text: 'سابقه لیگ‌ها' }),
    el('th', { text: 'مدیریت' }),
  ])]));
  const tbody = el('tbody');
  for (const profile of items) {
    const current = latestMembership(profile);
    const memberships = el('div.row', { style: { flexWrap: 'wrap' } }, profile.memberships.map((membership) => chip(
      membership.leagueName,
      membership.leagueStatus === 'active' ? 'ok' : 'muted',
    )));
    tbody.appendChild(el('tr', {}, [
      el('td.name-cell', {}, [el('strong', { text: profile.name })]),
      el('td', {}, [profile.hasLogin
        ? chip(profile.username || 'فعال', 'ok')
        : chip('بدون حساب', 'muted')]),
      el('td', { text: profile.parentPhone || 'ثبت نشده' }),
      el('td', {}, [current
        ? chip(current.leagueName, current.leagueStatus === 'active' ? 'ok' : 'muted')
        : chip('بدون لیگ', 'muted')]),
      el('td', {}, [memberships]),
      el('td', {}, [current
        ? el('a.btn.btn--ghost.btn--sm', {
          href: `#/teacher/league/${current.leagueId}/contacts`,
          text: 'ویرایش اطلاعات',
          onclick: () => setLeagueId(current.leagueId),
        })
        : el('span.muted.small', { text: '—' })]),
    ]));
  }
  table.appendChild(tbody);
  return tableWrap(table);
}

function transferCard(leagues, reload) {
  const sources = leagues.filter((league) => Number(league.studentCount) > 0);
  const targets = leagues.filter((league) => league.status === 'active');
  if (!sources.length || !targets.length) {
    return card({ title: 'انتقال به لیگ جدید', icon: '🔄' }, [
      el('p.muted.small', { text: 'برای انتقال، دست‌کم یک لیگ دارای دانش‌آموز و یک لیگ فعال لازم است.' }),
    ]);
  }

  const preferredTarget = targets.find((league) => league.id === state.leagueId && Number(league.studentCount) === 0)
    ?? targets.find((league) => Number(league.studentCount) === 0)
    ?? targets[0];
  const target = el('select', { 'aria-label': 'لیگ مقصد' });
  for (const league of targets) option(target, league);
  target.value = String(preferredTarget.id);
  const source = el('select', { 'aria-label': 'لیگ مبدأ' });

  function paintSources() {
    const targetId = Number(target.value);
    const previous = Number(source.value);
    source.replaceChildren();
    const available = sources.filter((league) => league.id !== targetId);
    for (const league of available) option(source, league, league.status === 'completed' ? ' · پایان‌یافته' : '');
    const preferred = available.find((league) => league.id === previous)
      ?? available.find((league) => league.status === 'completed')
      ?? available[0];
    source.value = preferred ? String(preferred.id) : '';
  }
  paintSources();
  target.addEventListener('change', paintSources);

  const transfer = button('انتقال دانش‌آموزان', {
    kind: 'primary',
    icon: '🔄',
    onClick: async () => {
      const sourceLeague = leagues.find((league) => league.id === Number(source.value));
      const targetLeague = leagues.find((league) => league.id === Number(target.value));
      if (!sourceLeague || !targetLeague) return;
      const agreed = await confirmDialog({
        title: 'انتقال دانش‌آموزان',
        message: `اطلاعات دانش‌آموزان «${sourceLeague.name}» به «${targetLeague.name}» منتقل شود؟ امتیازها و سوابق قبلی منتقل نمی‌شوند.`,
        confirmLabel: 'انتقال',
      });
      if (!agreed) return;
      transfer.disabled = true;
      try {
        const payload = await api.post(`/leagues/${targetLeague.id}/students/import`, {
          sourceLeagueId: sourceLeague.id,
        });
        const result = payload?.result ?? {};
        setLeagueId(targetLeague.id);
        notify.ok(result.imported > 0
          ? `${fa(result.imported)} دانش‌آموز به لیگ جدید منتقل شد`
          : 'همه دانش‌آموزان از قبل در لیگ مقصد حضور دارند');
        await reload();
      } catch (error) {
        notify.error(errorMessage(error));
      } finally {
        transfer.disabled = false;
      }
    },
  });

  return card({ title: 'انتقال به لیگ جدید', icon: '🔄' }, [
    el('p.small.muted', { text: 'نام، حساب ورود، شماره‌ها و لینک شاد حفظ می‌شود. امتیاز، حضور، تیم و تاریخچه هر لیگ مستقل می‌ماند.' }),
    el('div.student-transfer-grid', {}, [
      el('div.field', {}, [el('label', { text: 'از لیگ' }), source]),
      el('div.field', {}, [el('label', { text: 'به لیگ فعال' }), target]),
    ]),
    el('div.row', {}, [transfer]),
  ]);
}

export async function renderStudentRoster() {
  setTopbarTitle('مدیریت دانش‌آموزان');
  setLeaguePill(null);
  const body = el('div', {}, [loadingNode()]);
  renderView([
    pageHead({
      icon: '🧑‍🎓',
      title: 'مدیریت دانش‌آموزان',
      subtitle: 'فهرست ثابت دانش‌آموزان شما، مستقل از پایان هر لیگ',
      actions: [backToWorkbench()],
    }),
    body,
  ]);

  async function load() {
    body.replaceChildren(loadingNode());
    try {
      const [rosterPayload, leaguesPayload] = await Promise.all([
        api.get('/students/roster'),
        api.get('/leagues'),
      ]);
      const items = rosterPayload?.items ?? [];
      const leagues = leaguesPayload?.items ?? [];
      body.replaceChildren(el('div.grid', { style: { gap: '14px' } }, [
        transferCard(leagues, load),
        card({ title: `فهرست ثابت دانش‌آموزان · ${fa(items.length)} نفر`, icon: '📋' }, [
          items.length
            ? rosterTable(items)
            : emptyState({
              icon: '🧑‍🎓',
              title: 'هنوز دانش‌آموزی ثبت نشده است',
              hint: 'دانش‌آموزان را در لیگ انفرادی اضافه کنید؛ پس از آن همیشه در این فهرست باقی می‌مانند.',
            }),
        ]),
      ]));
    } catch (error) {
      body.replaceChildren(emptyState({
        icon: '⚠️',
        title: 'دریافت فهرست دانش‌آموزان ناموفق بود',
        hint: errorMessage(error),
      }));
    }
  }

  await load();
}
