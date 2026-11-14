import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Half the cores, not all but one: npm test runs two packages at once, and the server suite's files each boot
    // servers and fake CLIs. Unbounded, a whole run was killed with exit 137. Override with --maxWorkers.
    maxWorkers: '50%',
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/global-tmpdir.ts'],
    // Never let a test touch the real data/omni.db. Tests that need db.ts mock it.
    // OMNI_CURSOR_DASHBOARD: no test calls Cursor's real dashboard; tests that need it pass a fake. OMNI_USAGE_PRICES: nor LiteLLM's price list.
    // OMNI_CURSOR_API_URL: nor the real Cursor Cloud API. A closed local port, unless a test passes the fake.
    // OMNI_TOKEN: the API token every test request carries (tests/setup.ts adds it to app.request), so no test makes data/api-token.
    // OMNI_HARDWARE_ID: every test Mac is the same hardware, unless a test says otherwise (apps/server/tests/sync-clone.test.ts).
    // OMNI_CLAUDE_LOGIN_SYNC: no test copies the real Claude Code login into the real Keychain (harness/claude/login-sync.ts).
    // OMNI_UPDATE_CHECK, OMNI_CAFFEINATE: a test server never fetches origin or keeps the Mac awake (update.ts, index.ts).
    env: { OMNI_CLAUDE_LOGIN_SYNC: '0', OMNI_UPDATE_CHECK: '0', OMNI_CAFFEINATE: '0', OMNI_BROWSER: '1', OMNI_BROWSER_LIVE: '0', OMNI_TZ: 'Europe/Amsterdam', OMNI_HARDWARE_ID: 'test-mac', OMNI_CURSOR_DASHBOARD: '0', OMNI_USAGE_PRICES: '0', OMNI_CURSOR_API_URL: 'http://127.0.0.1:9', OMNI_TOKEN: 'test-token-0123456789abcdef0123456789abcdef' },
  },
});
