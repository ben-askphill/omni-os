import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Half the cores, not all but one: npm test runs two packages at once, and the server suite's files each boot
    // servers and fake CLIs. Unbounded, a whole run was killed with exit 137. Override with --maxWorkers.
    maxWorkers: '50%',
    // Never let a test touch the real data/omni.db. Tests that need db.ts mock it.
    // OMNI_HARDWARE_ID: every test Mac is the same hardware, unless a test says otherwise (apps/server/tests/sync-clone.test.ts).
    env: { OMNI_BROWSER: '1', OMNI_BROWSER_LIVE: '0', OMNI_TZ: 'Europe/Amsterdam', OMNI_HARDWARE_ID: 'test-mac' },
  },
});
