import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    // Never let a test touch the real data/omni.db. Tests that need db.ts mock it.
    // OMNI_CURSOR_DASHBOARD: no test calls Cursor's real dashboard; tests that need it pass a fake.
    // OMNI_WORKTREE_SWEEP: archiving a thread in a test leaves its worktree; worktree-sweep tests turn it on.
    // OMNI_HARDWARE_ID: every test Mac is the same hardware, unless a test says otherwise (apps/server/tests/sync-clone.test.ts).
    env: { OMNI_BROWSER: '1', OMNI_BROWSER_LIVE: '0', OMNI_TZ: 'Europe/Amsterdam', OMNI_HARDWARE_ID: 'test-mac', OMNI_CURSOR_DASHBOARD: '0', OMNI_WORKTREE_SWEEP: '0' },
  },
});
