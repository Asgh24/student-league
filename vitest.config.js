import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    environment: 'node',
    // removed `pool: 'forks'` because spawning many forked workers can crash
    // in CI when native modules (e.g. better-sqlite3) are used. Let Vitest
    // reuse workers by default to avoid SIGSEGV in forks.
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['default'],
  },
});
