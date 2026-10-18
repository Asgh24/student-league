import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The browser loads the frontend modules natively (no bundler), so a named
 * import that does not exist in its target module breaks the whole app with a
 * hard `SyntaxError`. Vite's transform used by the jsdom suites is lenient about
 * that, so this suite links `public/js` by hand: every relative named import must
 * resolve to an export of the file it points at.
 */

const ROOT = path.join(process.cwd(), 'public', 'js');

function listModules(dir = ROOT) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listModules(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

/** Exported names of a module, without executing it. */
function exportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const [local, alias] = piece.split(/\s+as\s+/);
      names.add((alias ?? local).trim());
    }
  }
  if (/export\s+default/.test(source)) names.add('default');
  return names;
}

/** `[names, specifier]` of every relative named import in a module. */
function namedImports(source) {
  const found = [];
  const pattern = /import\s+(?:[A-Za-z0-9_$]+\s*,?\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (!match[2].startsWith('.')) continue;
    const names = match[1]
      .split(',')
      .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    if (names.length) found.push([names, match[2]]);
  }
  return found;
}

describe('frontend module links', () => {
  it('covers every module under public/js', () => {
    expect(listModules().length).toBeGreaterThan(20);
  });

  it('resolves every relative named import to a real export', () => {
    const problems = [];
    for (const file of listModules()) {
      const source = fs.readFileSync(file, 'utf8');
      const relative = path.relative(process.cwd(), file).replaceAll('\\', '/');
      for (const [names, specifier] of namedImports(source)) {
        const target = path.resolve(path.dirname(file), specifier);
        if (!fs.existsSync(target)) {
          problems.push(`${relative} → missing file ${specifier}`);
          continue;
        }
        const available = exportedNames(fs.readFileSync(target, 'utf8'));
        for (const name of names) {
          if (!available.has(name)) problems.push(`${relative} imports "${name}" from ${specifier}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
