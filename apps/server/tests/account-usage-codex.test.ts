import { beforeAll, describe, expect, it } from 'vitest';
import type { HarnessAccount } from '@omni/shared/harness-accounts.ts';
import type { AccountUsage } from '@omni/shared/account-usage.ts';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

// Codex's account/rateLimits/updated can leave out the weekly window. Through the real adapter and runner, the gap is
// filled from this account's own last reading, never from the per-harness key another machine's account wrote last.

let H: Awaited<ReturnType<typeof startRunner>>;
let accounts: typeof import('../harness-accounts.ts');
const codex = { harness: 'codex', model: 'gpt-5.6-sol' };

const reader = async (harness: string): Promise<HarnessAccount> =>
  harness === 'codex'
    ? { harness, state: 'signed-in', label: 'a-codex@example.com', org: null, plan: 'Plus', note: null, switched: null }
    : { harness, state: 'not-installed', label: null, org: null, plan: null, note: null, switched: null };

const filed = () => H.db.kv.list<AccountUsage>('usage-account.codex.').map(([, v]) => v);

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX });
  accounts = await import('../harness-accounts.ts');
  accounts.configureAccounts({ read: reader });
});

describe("a partial Codex rate-limit update on this machine's account", () => {
  it("keeps this account's own week, not the one another account last wrote to usage:codex", async () => {
    const t = await H.start('hello', codex);
    await H.untilResults(t.id, 1);
    await accounts.usageFiled();
    // The first turn's full update: 12% and 3%, filed under this machine's account.
    expect(filed()).toMatchObject([{ label: 'a-codex@example.com', usage: { five_hour: { utilization: 0.12 }, seven_day: { utilization: 0.03 } } }]);

    // Another machine on another Codex account syncs in its reading: the per-harness key now holds its 90% week.
    H.db.kv.set('usage:codex', { five_hour: { utilization: 0.1, resetsAt: 1790328600 }, seven_day: { utilization: 0.9, resetsAt: 1790922600 }, updated_at: new Date().toISOString() });

    H.runner.sendMessage(t.id, 'FIVEONLY:20', { mode: 'steer' });
    await H.untilResults(t.id, 2);
    await accounts.usageFiled();
    const mine = filed();
    expect(mine).toHaveLength(1);
    expect(mine[0]!.usage).toMatchObject({ five_hour: { utilization: 0.2 }, seven_day: { utilization: 0.03 } });
  });
});
