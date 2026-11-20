import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ContextUsage } from '@omni/shared/context-meter.ts';
import type { Thread } from '../src/api.ts';
import { takeDisplay } from '../src/display.ts';

// The channel stack reads the channel list; the rest of the store works without a provider.
vi.mock('../src/store.tsx', async (load) => ({ ...(await load<object>()), useApp: () => ({ channels: [] }) }));

import { ThreadHeader } from '../src/components/thread/ThreadHeader.tsx';

// The context ring shows on every thread's header, whatever Show technical details says and whether or not the channel
// has a repo: a new thread, a running one, an idle one and a cold one, at any level. Only a harness that reports no
// window (Hermes) leaves it out.

beforeAll(() => takeDisplay({ technical: false, shopify: false, openItems: false }));
afterAll(() => takeDisplay({ technical: true, shopify: true, openItems: false }));

const thread = (over: Partial<Thread> = {}) =>
  ({ id: 't1', channel_id: 'notes', title: 'Brief', status: 'done', has_run: 1, harness: 'claude-code', session_id: 's1', cwd: '/home/u/Omni/notes', source: 'manual', archived: 0, pinned_at: null, done_at: null, role: null, created_at: '2026-11-18T09:00:00.000Z', updated_at: '2026-11-18T09:00:00.000Z', ...over }) as Thread;

const reading = (used: number): ContextUsage => ({ used, max: 200_000, model: 'claude-opus-5-5', source: 'claude-cli', updated_at: '2026-11-20T09:00:00.000Z' });

/** A channel without a repo: the case Show technical details off hid the ring in. */
const notes = { id: 'notes', name: 'Notes', repo_path: null };

const header = (t: Thread, context: ContextUsage | null) =>
  renderToStaticMarkup(
    createElement(ThreadHeader, {
      thread: t,
      channel: notes as never,
      parent: null,
      links: { from: null, into: [] },
      modLines: [],
      delegated: [],
      roleName: null,
      actions: { thread: t, context, onCompacted: () => {}, reconnecting: false, onDone: () => {}, onRestore: () => {}, restoring: false, panelOpen: true, onPanel: () => {}, artifactCount: 0 },
    }),
  );

const RING = 'aria-label="Context used"';

describe('the context ring with Show technical details off', () => {
  it.each([
    ['a new thread', thread({ status: 'queued', has_run: 0, session_id: undefined }), null],
    ['a running thread', thread({ status: 'running' }), reading(24_000)],
    ['an idle thread', thread({ status: 'done' }), reading(60_000)],
    ['a cold thread', thread({ status: 'stopped' }), reading(90_000)],
  ])('shows on %s in a channel without a repo', (_, t, context) => {
    expect(header(t, context)).toContain(RING);
  });

  it('shows the level well under the window filling up', () => {
    const html = header(thread(), reading(24_000));
    expect(html).toContain('aria-valuenow="12"');
    expect(html).toContain('12%');
  });

  it('stays out of a thread whose harness reports no window', () => {
    expect(header(thread({ harness: 'hermes' }), null)).not.toContain(RING);
  });
});
