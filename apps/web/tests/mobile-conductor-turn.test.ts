import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WIRE_FIXTURES } from '@omni/test-fixtures';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Channel, Thread } from '../src/api.ts';
import type { TurnView } from '../src/mobile/ThreadCards.tsx';

// The "Conductor" line over a finished Conductor answer on the phone. It names the Conductor as the turn's author, so
// it wears the icon and background saved for the Conductor, as its rows and header do (packages/shared/channel-icon.ts
// hasOwnLook). Without one it keeps the live Omni mark, delegating while its crew runs.
vi.mock('../src/store.tsx', () => ({
  useApp: () => ({ channels: [], channel: () => undefined, needsYou: null, profile: null, tasks: [] }),
  useNow: () => Date.parse('2026-01-05T12:00:00.000Z'),
  readPref: (_key: string, fallback: unknown) => fallback,
  writePref: () => {},
}));

import { Turn, type TurnCtx } from '../src/mobile/ThreadTurn.tsx';

const OMNI_MARK = 'class="mark ';
const BG = 'background-color:#283c62';
const base = (JSON.parse(readFileSync(resolve(WIRE_FIXTURES, 'recent.json'), 'utf8')) as Thread[])[0];
const thread = { ...base, id: 'lead', channel_id: 'conductor', role: 'conductor', parent_id: null, status: 'done' } as Thread;
const conductor = (over: Partial<Channel> = {}) => ({ id: 'conductor', name: 'Conductor', kind: 'system', icon: null, avatar_bg: null, ...over }) as Channel;

const turn: TurnView = {
  key: 1, at: '2026-01-05T11:58:00.000Z', prompts: [], steps: 0, failed: 0, texts: ['All three PRs are open.'], prose: 'All three PRs are open.',
  proseClipped: null, reports: [], questions: [], artifacts: [], children: [], result: null, error: null, cloud: null, status: 'done',
  items: [], switches: [], harness: 'claude-code',
};

const ctx = (over: Partial<TurnCtx> = {}): TurnCtx =>
  ({
    thread, view: { plan: null }, history: { history: {} }, conductor: true, conductorChannel: conductor(), crew: [], ch: conductor(),
    changes: null, pr: null, now: Date.parse('2026-01-05T12:00:00.000Z'), shell: { open: vi.fn() }, status: null, ...over,
  }) as unknown as TurnCtx;

/** The quiet line naming the Conductor: from the start of its row to its name. */
const label = (c: TurnCtx) => {
  const markup = renderToStaticMarkup(createElement(Turn, { t: turn, first: true, last: true, c }));
  const at = markup.indexOf('Conductor</div>');
  expect(at).toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf('<div', at), at);
};

describe("the Conductor's name over its answer on the phone", () => {
  it('draws the Omni mark while the Conductor has no look of its own', () => {
    for (const conductorChannel of [undefined, conductor(), conductor({ icon: 'icon:not-a-glyph' })]) {
      const line = label(ctx({ conductorChannel }));
      expect(line).toContain(OMNI_MARK);
      expect(line).not.toContain('background-color');
    }
  });

  it('keeps the mark moving while its crew runs', () => {
    const line = label(ctx({ crew: [{ ...thread, id: 'kid', status: 'running' } as Thread] }));
    expect(line).toContain('aria-label="Omni, delegating"');
  });

  it('draws the icon and background saved for it instead', () => {
    const line = label(ctx({ conductorChannel: conductor({ icon: '🎼', avatar_bg: '#283c62' }) }));
    expect(line).not.toContain(OMNI_MARK);
    expect(line).toContain('🎼');
    expect(line).toContain(BG);
  });

  it('takes either half of the look: a saved icon alone, or a background alone behind the Omni mark', () => {
    const icon = label(ctx({ conductorChannel: conductor({ icon: 'icon:target' }) }));
    expect(icon).not.toContain(OMNI_MARK);
    expect(icon).toContain('<svg');
    const bg = label(ctx({ conductorChannel: conductor({ avatar_bg: '#283c62' }) }));
    expect(bg).toContain(OMNI_MARK);
    expect(bg).toContain(BG);
  });

  it("follows the Conductor's look on a conductor-role thread in another channel, not that channel's", () => {
    const line = label(ctx({ thread: { ...thread, channel_id: 'acme' }, ch: { ...conductor(), id: 'acme', name: 'acme', icon: '🛍️' }, conductorChannel: conductor() }));
    expect(line).toContain(OMNI_MARK);
    expect(line).not.toContain('🛍️');
  });
});
