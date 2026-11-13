// @vitest-environment jsdom
/**
 * Colour palettes: the orange-black "ember" theme is the default, the saved
 * choice survives reloads, and the picker in the settings page and top-bar
 * dialog repaints the document.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../public/js/api.js', () => {
  const api = {
    request: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    upload: vi.fn(),
  };
  return {
    api,
    ApiError: class ApiError extends Error {},
    setCsrfToken: vi.fn(),
    getCsrfToken: () => null,
    meta: vi.fn(),
    me: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  };
});

const {
  DEFAULT_PALETTE,
  PALETTE_STORAGE_KEY,
  PALETTES,
  applyPalette,
  currentPalette,
  initPalette,
  normalizePalette,
  openPaletteDialog,
  paletteSwatches,
  storedPalette,
} = await import('../public/js/theme.js');
const { renderSettings } = await import('../public/js/views/settings.js');
const { setUser } = await import('../public/js/store.js');

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function shell(html = '') {
  document.body.innerHTML = `
    <main class="view" id="view" tabindex="-1"></main>
    <div id="modal-root"></div>
    ${html}
  `;
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.palette;
  shell();
  setUser(null);
});

describe('palette tokens', () => {
  it('ships an orange-black default and keeps the other palettes available', () => {
    const base = fs.readFileSync(path.join(rootDir, 'public', 'css', 'base.css'), 'utf8');
    expect(base).toMatch(/:root\s*\{[\s\S]*?--brand:\s*#ea580c/);
    expect(base).toContain('[data-palette="violet"]');
    expect(base).toContain('[data-palette="ocean"]');
    expect(PALETTES.map((palette) => palette.id)).toEqual(['ember', 'violet', 'ocean']);
    expect(DEFAULT_PALETTE).toBe('ember');
  });

  it('boots the saved palette before the app module loads', () => {
    const html = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
    expect(html).toContain('data-palette="ember"');
    expect(html).toContain('/js/paletteBoot.js');
    expect(html).toContain('id="palette-btn"');
    const boot = fs.readFileSync(path.join(rootDir, 'public', 'js', 'paletteBoot.js'), 'utf8');
    expect(boot).toContain(PALETTE_STORAGE_KEY);
    expect(boot).toContain("'ember'");
    expect(boot).toContain("'violet'");
    expect(boot).toContain("'ocean'");
  });
});

describe('palette state', () => {
  it('falls back to the ember palette for unknown or empty values', () => {
    expect(normalizePalette('nope')).toBe('ember');
    expect(normalizePalette(null)).toBe('ember');
    expect(storedPalette()).toBe('ember');
    expect(currentPalette()).toBe('ember');
  });

  it('applies a palette to the root and remembers it', () => {
    expect(applyPalette('ocean')).toBe('ocean');
    expect(document.documentElement.dataset.palette).toBe('ocean');
    expect(localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('ocean');
    expect(storedPalette()).toBe('ocean');

    applyPalette('not-a-palette');
    expect(document.documentElement.dataset.palette).toBe('ember');
    expect(localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('ember');
  });

  it('restores the saved palette without overwriting storage', () => {
    localStorage.setItem(PALETTE_STORAGE_KEY, 'violet');
    initPalette();
    expect(document.documentElement.dataset.palette).toBe('violet');
  });
});

describe('palette picker UI', () => {
  it('renders a swatch per palette and repaints the settings page', () => {
    setUser({ id: 1, role: 'teacher', username: 'teacher-a', displayName: 'معلم', persianDigits: true });
    renderSettings();

    const swatches = [...document.querySelectorAll('#view .palette-swatch')];
    expect(swatches).toHaveLength(3);
    expect(swatches.find((node) => node.dataset.paletteId === 'ember').classList.contains('is-active')).toBe(true);

    swatches.find((node) => node.dataset.paletteId === 'ocean').click();
    expect(document.documentElement.dataset.palette).toBe('ocean');
    expect(localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('ocean');
    expect(document.querySelector('#view .palette-swatch.is-active').dataset.paletteId).toBe('ocean');
  });

  it('opens the top-bar dialog and applies the chosen palette', () => {
    const modal = openPaletteDialog();
    expect(document.querySelector('#modal-root .palette-grid')).not.toBeNull();
    document.querySelector('#modal-root [data-palette-id="violet"]').click();
    expect(document.documentElement.dataset.palette).toBe('violet');
    expect(document.querySelector('#modal-root .palette-swatch.is-active').dataset.paletteId).toBe('violet');
    modal.close();
  });

  it('keeps a standalone swatch group in sync', () => {
    const group = paletteSwatches();
    document.body.appendChild(group);
    group.querySelector('[data-palette-id="violet"]').click();
    expect(group.querySelector('.palette-swatch.is-active').dataset.paletteId).toBe('violet');
  });
});
