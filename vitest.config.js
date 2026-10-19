import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    environment: 'node',
    // remove per-file isolation to avoid spawning one worker per file in CI.
    // Vitest's isolate:true or pool:'forks' causes many child processes which can
    // crash (SIGSEGV) when native modules like better-sqlite3 are loaded.
    isolate: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['default'],
  },
});
