import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// The repo's vite.config.ts sets root: 'web' for the UI build, so vitest would only look in web/.
// Run server/script tests with: npx vitest run --config tests/vitest.config.ts
export default defineConfig({
  root: resolve(import.meta.dirname, '..'),
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    // Never let a test touch the real data/omni.db. Tests that need db.ts mock it.
    // OMNI_HARDWARE_ID: every test Mac is the same hardware, unless a test says otherwise (tests/sync-clone.test.ts).
    env: { OMNI_BROWSER: '1', OMNI_TZ: 'Europe/Amsterdam', OMNI_HARDWARE_ID: 'test-mac' },
  },
});
