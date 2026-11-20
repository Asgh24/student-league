import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Single source of truth for the application version: `package.json`.
 * Used by the server, the `/meta` payload and the backup manifest.
 */
export const APP_VERSION = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
).version;

/**
 * Content fingerprint for the frontend shipped by this process. Unlike the
 * semantic package version, this changes automatically whenever any public
 * HTML, CSS, JS, font or image changes, so an open tab can reliably notice a
 * deployment without somebody remembering to bump a number by hand.
 */
export function frontendReleaseId(directory = fileURLToPath(new URL('../public', import.meta.url))) {
  const hash = crypto.createHash('sha256');

  function addDirectory(current, relative = '') {
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const childRelative = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) addDirectory(absolute, childRelative);
      else if (entry.isFile()) {
        hash.update(childRelative);
        hash.update('\0');
        hash.update(fs.readFileSync(absolute));
        hash.update('\0');
      }
    }
  }

  addDirectory(directory);
  return hash.digest('hex').slice(0, 16);
}

export const APP_RELEASE = frontendReleaseId();
