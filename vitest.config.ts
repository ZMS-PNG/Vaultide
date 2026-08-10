import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup-env.ts'],
    // The combined Vaultide + upstream suite now spans thousands of tests and
    // several IndexedDB/runtime stress cases. Bound worker contention so a
    // correct 5-8 second stress test is not turned into a false timeout by
    // hundreds of simultaneous module transforms.
    // One worker is the measured stable baseline on the supported Windows
    // machine. Two or more workers can starve dynamic imports in the
    // classroom and Pi stress suites, producing false 15s timeouts.
    // Keep the strict per-test timeout: scheduler pressure must not be hidden
    // by making genuinely stalled tests wait longer.
    maxWorkers: 1,
    testTimeout: 15_000,
  },
});
