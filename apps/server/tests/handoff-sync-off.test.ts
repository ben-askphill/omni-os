import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// A handoff needs a running sync: the refusal says which part is missing, as the Sync page would.

const h = await startRunner();
const { db } = await import('../db.ts');
const { handOff } = await import('../handoff.ts');
const { SYNC_SECRETS } = await import('../secrets.ts');

const refusal = (id: string) => handOff(id, 'mac-b').then(() => '', (err: Error & { status?: number }) => `${err.status} ${err.message}`);

describe('handing off with sync not running', () => {
  it('says sync is not set up, then paused, then set up but not running', async () => {
    const t = await h.runner.createThread({ channel: 'scratch', prompt: 'TOOL:60000 a long one' });
    expect(await refusal(t.id)).toBe('409 Sync is not set up on this Mac. Handing a thread off needs sync on both Macs.');

    h.db.outbox.arm('mac-a');
    for (const name of Object.values(SYNC_SECRETS)) db.prepare('INSERT INTO secrets (scope, name) VALUES (?, ?)').run('global', name);
    h.db.kv.set('sync.enabled', false);
    expect(await refusal(t.id)).toBe('409 Sync is paused on this Mac. Resume it on the Sync page to hand threads off.');

    h.db.kv.set('sync.enabled', true);
    expect(await refusal(t.id)).toBe(
      '409 Sync is set up on this Mac but not running, so the other Mac cannot be told. Check the Sync page, then try again.',
    );
  });
});
