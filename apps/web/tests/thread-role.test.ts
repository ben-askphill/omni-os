import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { crewRoleName } from '@omni/shared/crew-role.ts';
import type { Thread } from '../src/api.ts';

// The channel stack reads the channel list; the rest of the store works without a provider.
vi.mock('../src/store.tsx', async (load) => ({ ...(await load<object>()), useApp: () => ({ channels: [] }) }));

import { ThreadHeader } from '../src/components/thread/ThreadHeader.tsx';
import { DetailsTab } from '../src/components/thread/panel/DetailsTab.tsx';

// A thread started as a crew role names it in the header and in Details, by the name its charter gives it. A thread
// started without one shows neither.

const crew = [
  { id: 'builder', name: 'Builder' },
  { id: 'store-ops', name: 'Store ops' },
];

const thread = (over: Partial<Thread> = {}) =>
  ({ id: 't1', channel_id: 'omni-os', title: 'Show the role', status: 'done', harness: 'claude-code', session_id: 's1', cwd: '/w', source: 'conductor', archived: 0, pinned_at: null, done_at: null, role: null, created_at: '2026-11-18T09:00:00.000Z', updated_at: '2026-11-18T09:00:00.000Z', ...over }) as Thread;

const header = (t: Thread) =>
  renderToStaticMarkup(
    createElement(ThreadHeader, {
      thread: t,
      channel: undefined,
      parent: null,
      links: { from: null, into: [] },
      modLines: [],
      delegated: [],
      roleName: crewRoleName(t.role, crew),
      actions: { thread: t, meter: null, reconnecting: false, onDone: () => {}, onRestore: () => {}, restoring: false, panelOpen: true, onPanel: () => {}, artifactCount: 0 },
    }),
  );

const details = (t: Thread) =>
  renderToStaticMarkup(
    createElement(DetailsTab, { thread: t, roleName: crewRoleName(t.role, crew), channel: undefined, parent: null, children: [], init: null, lastResult: null, warm: undefined, links: { from: null, into: [] }, agents: [], onJump: () => {} }),
  );

/** The Details row names, in order. */
const rows = (html: string) => [...html.matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)].map((m) => m[1]);

describe('the crew role of a thread', () => {
  it('shows in the header by its display name, with its avatar', () => {
    const html = header(thread({ role: 'store-ops' }));
    expect(html).toContain('data-role="store-ops"');
    expect(html).toContain('>Store ops<');
    expect(html).toContain('title="Runs as Store ops"');
    // A built-in's mark, as its avatar: the chip's text names it.
    expect(html).toMatch(/title="Runs as Store ops"[^>]*><span aria-hidden="true"[^>]*><svg/);
  });

  it('has an Agent row in Details, right under Channel', () => {
    const html = details(thread({ role: 'builder' }));
    expect(rows(html).slice(0, 3)).toEqual(['Channel', 'Agent', 'Harness']);
    expect(html).toContain('data-role="builder"');
    expect(html).toContain('Builder');
  });

  it('shows neither on a thread not started as a crew role', () => {
    const t = thread({ role: null, source: 'manual' });
    expect(header(t)).not.toContain('data-role');
    expect(header(t)).not.toContain('Runs as');
    expect(rows(details(t))).not.toContain('Agent');
  });

  it('keeps a role it no longer lists by the id it ran with', () => {
    expect(header(thread({ role: 'my-role' }))).toContain('>my-role<');
    expect(details(thread({ role: 'my-role' }))).toContain('data-role="my-role"');
  });

  it('leaves it out of the Conductor own header, but keeps it in Details', () => {
    const t = thread({ role: 'conductor', channel_id: 'conductor' });
    expect(header(t)).not.toContain('data-role');
    expect(rows(details(t))).toContain('Agent');
  });
});
