/** Access to the static shell markup (topbar, drawer, view container). */

import { mount } from './dom.js';
import { state } from './store.js';

const byId = (id) => document.getElementById(id);

export function viewRoot() {
  return byId('view');
}

/** Replaces the routed view content and resets scroll/focus. */
export function renderView(node) {
  const root = viewRoot();
  mount(root, node);
  const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent ?? '');
  if (typeof window !== 'undefined' && !isJsdom) window.scrollTo({ top: 0, behavior: 'auto' });
  return root;
}

export function openDrawer() {
  byId('drawer')?.classList.add('is-open');
  byId('drawer')?.setAttribute('aria-hidden', 'false');
  const scrim = byId('scrim');
  if (scrim) scrim.hidden = false;
  byId('menu-btn')?.setAttribute('aria-expanded', 'true');
}

export function closeDrawer() {
  byId('drawer')?.classList.remove('is-open');
  byId('drawer')?.setAttribute('aria-hidden', 'true');
  const scrim = byId('scrim');
  if (scrim) scrim.hidden = true;
  byId('menu-btn')?.setAttribute('aria-expanded', 'false');
}

export function drawerIsOpen() {
  return Boolean(byId('drawer')?.classList.contains('is-open'));
}

export function setTopbarTitle(text) {
  const node = byId('topbar-title');
  if (node) node.textContent = text;
}

export function showTopbar(visible) {
  const topbar = byId('topbar');
  if (topbar) topbar.hidden = !visible;
}

export function setUserPill() {
  const pill = byId('user-pill');
  if (!pill) return;
  if (!state.user) {
    pill.hidden = true;
    return;
  }
  const role = state.user.role === 'admin' ? 'مدیر' : state.user.role === 'teacher' ? 'معلم' : 'دانش‌آموز';
  pill.hidden = false;
  pill.textContent = `${state.user.displayName} · ${role}`;
}

export function setLeaguePill(league) {
  const pill = byId('league-pill');
  if (!pill) return;
  if (!league) {
    pill.hidden = true;
    return;
  }
  pill.hidden = false;
  pill.textContent = `🏆 ${league.name}`;
}

export function setDrawerTitle(text) {
  const node = byId('drawer-title');
  if (node) node.textContent = text;
}

/** `items` = [{ group } | { label, href, icon, active }] ; `foot` is a DOM node. */
export function renderDrawerNav(items) {
  const nav = byId('drawer-nav');
  if (!nav) return;
  mount(nav, []);
  for (const item of items) {
    if (item.group) {
      const group = document.createElement('div');
      group.className = 'drawer__group';
      group.textContent = item.group;
      nav.appendChild(group);
      continue;
    }
    const link = document.createElement('a');
    link.href = `#/${String(item.href).replace(/^#?\/?/, '')}`;
    link.textContent = `${item.icon ? `${item.icon} ` : ''}${item.label}`;
    if (item.active) link.classList.add('is-active');
    nav.appendChild(link);
  }
}

export function renderDrawerFoot(node) {
  const foot = byId('drawer-foot');
  if (foot) mount(foot, node);
}

export function bindShellHandlers({ onLogout, onLeaguePill }) {
  byId('menu-btn')?.addEventListener('click', () => {
    if (drawerIsOpen()) closeDrawer();
    else openDrawer();
  });
  byId('drawer-close')?.addEventListener('click', closeDrawer);
  byId('scrim')?.addEventListener('click', closeDrawer);
  byId('drawer-nav')?.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeDrawer();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawerIsOpen()) closeDrawer();
  });
  byId('league-pill')?.addEventListener('click', () => {
    if (onLeaguePill) onLeaguePill();
  });
  if (onLogout) window.addEventListener('scl:logout', onLogout);
}
