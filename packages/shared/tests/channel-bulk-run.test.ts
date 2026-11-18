import { describe, expect, it } from 'vitest';
import { applyRunToChannels, bulkRunError, picksRun, resetChannelsToAuto, selectedIds, toggleSelected } from '../channel-bulk-run.ts';

/** A fake PATCH /api/channels/:id that records each body and fails for the ids in `fail`. */
function fakePatch(fail: string[] = []) {
  const sent: Record<string, unknown> = {};
  const patch = async (id: string, body: unknown) => {
    if (fail.includes(id)) throw new Error('Channel not found');
    sent[id] = body;
  };
  return { sent, patch };
}

describe('bulk channel default run', () => {
  it('sends the same run to every picked channel', async () => {
    const { sent, patch } = fakePatch();
    const r = await applyRunToChannels(['acme', 'volero', 'omni-os'], { harness: 'claude-code', model: 'opus', effort: 'high' }, patch);
    expect(r).toEqual({ done: ['acme', 'volero', 'omni-os'], failed: [] });
    const body = { default_harness: 'claude-code', default_model: 'opus', default_effort: 'high' };
    expect(sent).toEqual({ acme: body, volero: body, 'omni-os': body });
  });

  it('sends Auto picked from the list as an explicit Auto default', async () => {
    const { sent, patch } = fakePatch();
    await applyRunToChannels(['acme'], { harness: '', model: 'auto', effort: '' }, patch);
    expect(sent.acme).toEqual({ default_harness: null, default_model: 'auto', default_effort: null });
  });

  it('resets every picked channel to Auto by clearing all three fields', async () => {
    const { sent, patch } = fakePatch();
    const r = await resetChannelsToAuto(['acme', 'conductor'], patch);
    expect(r.done).toEqual(['acme', 'conductor']);
    const cleared = { default_harness: null, default_model: null, default_effort: null };
    expect(sent).toEqual({ acme: cleared, conductor: cleared });
  });

  it('keeps going when one channel fails and names it', async () => {
    const { sent, patch } = fakePatch(['volero']);
    const r = await applyRunToChannels(['acme', 'volero', 'patta'], { harness: 'codex', model: '', effort: '' }, patch);
    expect(r.done).toEqual(['acme', 'patta']);
    expect(r.failed).toEqual([{ id: 'volero', error: 'Channel not found' }]);
    expect(Object.keys(sent)).toEqual(['acme', 'patta']);
    expect(bulkRunError(r, (id) => `#${id}`)).toBe('#volero did not save: Channel not found');
    expect(bulkRunError({ done: [], failed: [{ id: 'a', error: 'x' }, { id: 'b', error: 'y' }] }, (id) => `#${id}`)).toBe('2 channels did not save (#a, #b): x');
    expect(bulkRunError({ done: ['a'], failed: [] }, String)).toBeNull();
  });

  it('sends nothing for an empty selection', async () => {
    const { sent, patch } = fakePatch();
    expect(await applyRunToChannels([], { harness: 'codex', model: '', effort: '' }, patch)).toEqual({ done: [], failed: [] });
    expect(sent).toEqual({});
  });
});

describe('bulk selection', () => {
  const listed = [{ id: 'conductor' }, { id: 'acme' }, { id: 'volero' }];

  it('toggles one id without touching the others', () => {
    const one = toggleSelected(new Set(), 'acme');
    expect([...one]).toEqual(['acme']);
    expect([...toggleSelected(new Set(['acme', 'volero']), 'acme')]).toEqual(['volero']);
  });

  it('keeps list order and drops ids no longer listed', () => {
    expect(selectedIds(listed, new Set(['volero', 'gone', 'conductor']))).toEqual(['conductor', 'volero']);
  });

  it('waits for a pick before Apply', () => {
    expect(picksRun({ harness: '', model: '', effort: '' })).toBe(false);
    expect(picksRun({ harness: '', model: 'auto', effort: '' })).toBe(true);
    expect(picksRun({ harness: 'codex', model: '', effort: '' })).toBe(true);
  });
});
