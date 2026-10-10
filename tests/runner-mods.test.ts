import { describe, it, expect } from 'vitest';
import { startRunner } from './runner-boot.ts';

// A mod's $.ui calls, as fake-claude's MODS and MOD_CLEAR directives send them: a log is stored, a toast goes
// out on the thread's stream only, and a status is pinned per plugin until it clears or the process ends.
const h = await startRunner();
const r = h.runner;
const T = { timeout: 20_000 };

describe('runner: mod ui events', () => {
  it('stores logs, streams toasts and pins one status per plugin until cleared', T, async () => {
    const feed: unknown[][] = [];
    const onFeed = (e: any) => e.type === 'mods' && feed.push(e.mods);
    h.bus.on('feed', onFeed);
    const t = await h.start('MODS please');
    const toasts: unknown[] = [];
    const onThread = (e: any) => e.kind === 'mod_toast' && toasts.push(e);
    h.bus.on(`thread:${t.id}`, onThread);
    await h.untilResults(t.id, 1);

    expect(h.byKind(t.id, 'mod').map((e) => e.p)).toEqual([{ plugin: 'omni-tool', level: 'log', text: 'omni-tool: thread_info served' }]);
    expect(r.activeMods()).toEqual([expect.objectContaining({ thread_id: t.id, channel_id: 'scratch', plugin: 'omni-tool', text: 'omni-tool: ready' })]);
    expect(feed.at(-1)).toEqual(r.activeMods());

    // The same status again is no news, and a toast never lands in the transcript.
    const sent = feed.length;
    r.sendMessage(t.id, 'MODS again');
    await h.untilResults(t.id, 2);
    expect(feed.length).toBe(sent);
    expect(r.activeMods()).toHaveLength(1);
    expect(h.byKind(t.id, 'mod')).toHaveLength(2);
    expect(h.byKind(t.id, 'mod_toast')).toEqual([]);
    expect(toasts.at(-1)).toEqual({ kind: 'mod_toast', thread_id: t.id, plugin: 'omni-tool', text: 'thread_info ran', timeout_ms: 4000 });

    r.sendMessage(t.id, 'MOD_CLEAR now');
    await h.untilResults(t.id, 3);
    expect(r.activeMods()).toEqual([]);
    expect(feed.at(-1)).toEqual([]);
    h.bus.off('feed', onFeed);
    h.bus.off(`thread:${t.id}`, onThread);
  });

  it('clears a status when the process ends', T, async () => {
    const t = await h.start('MODS then quit');
    await h.untilResults(t.id, 1);
    expect(r.activeMods().some((m) => m.thread_id === t.id)).toBe(true);
    await r.shutdownAll();
    expect(r.activeMods()).toEqual([]);
  });
});
