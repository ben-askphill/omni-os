import { describe, expect, it } from 'vitest';

import { machineOf } from '../../src/machine/facts';
import { menuExtras } from '../../src/thread/menu';
import { forkItem, organizeItems, targetOfThread } from '../../src/thread/target';
import { device, sync, takeover } from '../machine/fixtures';
import { thread } from './fixtures';

const idle = { status: 'done', blocked: null, handoff: null, takeover: null };
const holds = machineOf({ sync: sync(), devices: [device()], hereName: 'Laptop' }, idle);
const held = machineOf(null, { ...idle, takeover: takeover({ running: true }) });

describe('menuExtras', () => {
  it('shows Runs on only when there is a machine to pick', () => {
    const target = targetOfThread(thread());
    expect(menuExtras(target, null, false).map((e) => e.id)).toEqual([]);
    expect(menuExtras(target, holds, false)).toEqual([{ id: 'machine', label: 'Runs on Laptop', sub: 'Hand this thread to another synced machine', off: null }]);
  });

  it('names the machine that holds a thread that runs elsewhere, with the Take over note', () => {
    const [row] = menuExtras(targetOfThread(thread({ status: 'running' })), held, false);
    expect(row).toMatchObject({ id: 'machine', label: 'Runs on Studio', sub: 'This thread is running on Studio.' });
  });

  it('adds Fork thread after it when the screen can open Continue', () => {
    const extras = menuExtras(targetOfThread(thread()), holds, true);
    expect(extras.map((e) => e.id)).toEqual(['machine', 'fork']);
    expect(extras[1]).toEqual({ id: 'fork', label: 'Fork thread', sub: 'A new thread that picks up from here', off: null });
  });

  it('keeps Fork thread, dimmed with the reason, for a harness whose files are not on this machine', () => {
    const hermes = menuExtras(targetOfThread(thread({ harness: 'hermes' })), null, true);
    expect(hermes).toEqual([{ id: 'fork', label: 'Fork thread', sub: 'This thread runs on the Hermes server, so its files are not on this machine to continue from.', off: expect.stringContaining('Hermes') }]);
    const cloud = menuExtras(targetOfThread(thread({ harness: 'cursor-cloud' })), null, true);
    expect(cloud[0]?.off).toMatch(/Cursor's machines/);
    expect(cloud[0]?.sub).toBe(cloud[0]?.off);
  });

  it('adds Actions last, only where the screen can open them', () => {
    const extras = menuExtras(targetOfThread(thread()), holds, true, true);
    expect(extras.map((e) => e.id)).toEqual(['machine', 'fork', 'actions']);
    expect(extras[2]).toMatchObject({ id: 'actions', label: 'Actions', off: null });
    expect(menuExtras(targetOfThread(thread()), holds, true).map((e) => e.id)).toEqual(['machine', 'fork']);
  });

  it('offers no Fork thread without the screen to open it', () => {
    expect(menuExtras(targetOfThread(thread()), null, false)).toEqual([]);
  });
});

describe('the list row menu', () => {
  it('stays the Organize actions alone', () => {
    const ids = organizeItems(targetOfThread(thread())).map((i) => i.id);
    expect(ids).toEqual(['pin', 'done', 'rename', 'move', 'archive']);
    expect(forkItem(targetOfThread(thread()))?.id).toBe('fork');
  });
});
