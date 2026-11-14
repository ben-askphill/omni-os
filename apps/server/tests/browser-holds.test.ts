// A thread's hold on its channel's live browser (F17): each attach gets its own hold, so a spawn that a newer one
// replaced lets go of only its own, and the replacement's turn keeps the browser. No Chrome: start() is stubbed.
import { describe, expect, it } from 'vitest';

process.env.OMNI_BROWSER_LIVE = '1';
const { attachThread, channelBrowser, detachThread } = await import('../browser.ts');

describe('attachThread / detachThread', () => {
  it('keeps a newer spawn of the same thread holding the browser when the superseded one lets go', async () => {
    const b = channelBrowser('holds', true);
    (b as unknown as { start: () => Promise<string> }).start = async () => 'ws://127.0.0.1:9/devtools/browser/x';
    const old = await attachThread('holds', 'thread-1', true);
    const fresh = await attachThread('holds', 'thread-1', true);
    expect(old?.endpoint).toBe('ws://127.0.0.1:9/devtools/browser/x');
    expect(old?.hold).not.toBe(fresh?.hold);
    // The superseded spawn finishes starting Chrome after the replacement attached, and lets go of its own hold.
    detachThread('holds', old!.hold);
    expect([...b.holders]).toEqual([fresh!.hold]);
    detachThread('holds', fresh!.hold);
    expect(b.holders.size).toBe(0);
  });
});
