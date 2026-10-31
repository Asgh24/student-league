/** Shared application state plus a tiny subscription hook for the shell. */

const STORAGE_KEY = 'scl.leagueId';

const listeners = new Set();

export const state = {
  meta: {
    appName: 'لیگ جامع دانش‌آموزی',
    version: '',
    likesPerDay: 10,
    maxUploadBytes: 0,
    trialDays: 14,
    paymentProvider: 'mock',
  },
  user: null,
  leagueId: null,
  persianDigits: true,
  adminPendingPayments: 0,
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      /* a broken listener must not break the shell */
    }
  }
}

export function setMeta(meta) {
  state.meta = { ...state.meta, ...meta };
  if (state.meta.appName && typeof document !== 'undefined') document.title = state.meta.appName;
  emit();
}

/** Numeric badge shown on the admin payments icon in the drawer and tabs. */
export function setAdminPendingPayments(value) {
  const next = Math.max(0, Number.parseInt(value ?? 0, 10) || 0);
  if (next === state.adminPendingPayments) return;
  state.adminPendingPayments = next;
  emit();
}

export function setUser(user) {
  state.user = user ?? null;
  if (user?.role !== 'admin') state.adminPendingPayments = 0;
  state.persianDigits = user ? user.persianDigits !== false : true;
  if (user?.role !== 'teacher' && user?.role !== 'student') state.leagueId = null;
  // An assistant only ever sees the one league assigned by the owner.
  if (user?.assistant?.leagueId) {
    state.leagueId = Number(user.assistant.leagueId);
    try {
      localStorage.setItem(STORAGE_KEY, String(state.leagueId));
    } catch {
      /* storage may be unavailable in private mode */
    }
  }
  emit();
}

export function setPersianDigits(value) {
  state.persianDigits = Boolean(value);
  if (state.user) state.user.persianDigits = state.persianDigits;
  emit();
}

export function setLeagueId(value) {
  const id = value === null || value === undefined || value === '' ? null : Number(value);
  state.leagueId = Number.isFinite(id) ? id : null;
  try {
    if (state.leagueId === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(state.leagueId));
  } catch {
    /* storage may be unavailable in private mode */
  }
  emit();
}

export function storedLeagueId() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

export function isTeacher() {
  return state.user?.role === 'teacher';
}

/** A student-facing assistant account with a scoped teacher-like panel. */
export function isAssistant() {
  return Boolean(state.user?.assistant);
}

/** Section permission check; the owner teacher always has every section. */
export function can(permission) {
  if (!state.user) return true;
  if (!isTeacher()) return false;
  if (!isAssistant()) return true;
  return Array.isArray(state.user.assistant.permissions) && state.user.assistant.permissions.includes(permission);
}

export function isStudent() {
  return state.user?.role === 'student';
}

export function isAdmin() {
  return state.user?.role === 'admin';
}

/** Landing route for the current session. */
export function homePath() {
  if (isAdmin()) return 'admin';
  if (isTeacher()) return 'teacher';
  if (isStudent()) return 'student';
  return 'login';
}
