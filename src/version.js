import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Single source of truth for the application version: `package.json`.
 * Used by the server, the `/meta` payload and the backup manifest.
 */
export const APP_VERSION = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
).version;
