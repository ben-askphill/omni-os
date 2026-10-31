import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// A handoff, or a Take over, needs a running sync: the refusal says which part is missing, as Settings, Machines would.

const h = await startRunner();
const { db } = await import('../db.ts');
const { handOff, requestTakeover } = await import('../handoff.ts');
const { SYNC_SECRETS } = await import('../secrets.ts');

const why = (p: Promise<unknown>) => p.then(() => '', (err: Error & { status?: number }) => `${err.status} ${err.message}`);
/** Hand off and Take over refuse alike. */
const refusal = async (id: string) => {
  const [handing, taking] = await Promise.all([why(handOff(id, 'mac-b')), why(requestTakeover(id))]);
  expect(taking).toBe(handing);
  return handing;
};

describe('handing off or taking over with sync not running', () => {
  it('says sync is not set up, then paused, then set up but not running', async () => {
    const t = await h.runner.createThread({ channel: 'scratch', prompt: 'TOOL:60000 a long one' });
    expect(await refusal(t.id)).toBe('409 Sync is not set up on this Mac. Moving a thread between Macs needs sync on both.');

    h.db.outbox.arm('mac-a');
    for (const name of Object.values(SYNC_SECRETS)) db.prepare('INSERT INTO secrets (scope, name) VALUES (?, ?)').run('global', name);
    h.db.kv.set('sync.enabled', false);
    expect(await refusal(t.id)).toBe('409 Sync is paused on this Mac. Resume it in Settings, Machines to move threads between Macs.');

    h.db.kv.set('sync.enabled', true);
    expect(await refusal(t.id)).toBe(
      '409 Sync is set up on this Mac but not running, so the other Mac cannot be told. Check Settings, Machines, then try again.',
    );
  });
});
