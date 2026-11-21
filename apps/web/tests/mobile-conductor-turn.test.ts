import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WIRE_FIXTURES } from '@omni/test-fixtures';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Channel, Thread } from '../src/api.ts';
import type { TurnView } from '../src/mobile/ThreadCards.tsx';

// The author line over a finished Conductor answer on the phone.
vi.mock('../src/store.tsx', () => ({
  useApp: () => ({ channels: [], channel: () => undefined, needsYou: null, profile: null, tasks: [] }),
  useNow: () => Date.parse('2026-01-05T12:00:00.000Z'),
  useNeedOf: () => null,
  useChannel: () => undefined,
  useCrewRoles: () => [],
  readPref: (_key: string, fallback: unknown) => fallback,
  writePref: () => {},
}));

// The delegation card opens a thread through the phone shell.
vi.mock('../src/mobile/shell.tsx', async (load) => ({ ...(await load<object>()), useShell: () => ({ open: () => {}, back: () => {} }) }));

import { Turn, type TurnCtx } from '../src/mobile/ThreadTurn.tsx';

const OMNI_MARK = 'class="mark ';
const CHARACTER = 'data-shape="circle"';
const BG = 'background-color:#283c62';
const base = (JSON.parse(readFileSync(resolve(WIRE_FIXTURES, 'recent.json'), 'utf8')) as Thread[])[0];
const thread = { ...base, id: 'lead', channel_id: 'conductor', role: 'conductor', parent_id: null, status: 'done' } as Thread;
const conductor = (over: Partial<Channel> = {}) => ({ id: 'conductor', name: 'Conductor', kind: 'system', icon: null, avatar_bg: null, ...over }) as Channel;

const turn: TurnView = {
  key: 1, at: '2026-01-05T11:58:00.000Z', prompts: [], steps: 0, progress: null, failed: 0, texts: ['All three PRs are open.'], prose: 'All three PRs are open.',
  proseClipped: null, reports: [], questions: [], artifacts: [], children: [], asks: [], answers: {}, result: null, error: null, cloud: null, status: 'done',
  items: [], switches: [], members: [], harness: 'claude-code', author: 'conductor',
};

const ctx = (over: Partial<TurnCtx> = {}): TurnCtx =>
  ({
    thread, view: { turns: [] }, history: { history: {} }, conductor: true, conductorChannel: conductor(), crew: [], agents: [], ch: conductor(),
    changes: null, pr: null, now: Date.parse('2026-01-05T12:00:00.000Z'), shell: { open: vi.fn() }, status: null, ...over,
  }) as unknown as TurnCtx;

/** The quiet line naming the Conductor: from the start of its row to its name. */
const label = (c: TurnCtx) => {
  const markup = renderToStaticMarkup(createElement(Turn, { t: turn, first: true, last: true, c }));
  const at = markup.indexOf('>Conductor</span>');
  expect(at).toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf('<div', at), at);
};

describe("the Conductor's name over its answer on the phone", () => {
  it("draws the Conductor's crew character while the Conductor has no look of its own", () => {
    for (const conductorChannel of [undefined, conductor(), conductor({ icon: 'icon:not-a-glyph' })]) {
      const line = label(ctx({ conductorChannel }));
      expect(line).toContain(CHARACTER);
      expect(line).not.toContain(OMNI_MARK);
      expect(line).not.toContain('background-color');
    }
  });

  it('keeps its eyes idle while its crew runs: the status dots say what works', () => {
    const line = label(ctx({ crew: [{ ...thread, id: 'kid', status: 'running' } as Thread] }));
    expect(line).toContain('data-eyes="idle"');
    expect(line).not.toContain('delegating');
  });

  it('draws the agent avatar on the first reply in #conductor even with a saved channel icon', () => {
    const line = label(ctx({ conductorChannel: conductor({ icon: 'icon:play', avatar_bg: '#283c62' }) }));
    expect(line).toContain(CHARACTER);
    expect(line).not.toContain(BG);
  });

  it('uses the agent’s configured character on the first reply', () => {
    const line = label(ctx({
      conductorChannel: conductor({ icon: 'icon:play', avatar_bg: '#283c62' }),
      agents: [{ id: 'conductor', name: 'Conductor', avatar: { shape: 'cloud', bg: '#52cdfe' } }],
    }));
    expect(line).toContain('data-shape="cloud"');
    expect(line).toContain('#52cdfe');
  });

  it('takes a saved icon or background alone on Conductor replies in another channel', () => {
    const other = { ...thread, channel_id: 'acme' };
    const icon = label(ctx({ thread: other, conductorChannel: conductor({ icon: 'icon:target' }) }));
    expect(icon).not.toContain(OMNI_MARK);
    expect(icon).not.toContain(CHARACTER);
    expect(icon).toContain('<svg');
    const bg = label(ctx({ thread: other, conductorChannel: conductor({ avatar_bg: '#283c62' }) }));
    expect(bg).toContain(OMNI_MARK);
    expect(bg).toContain(BG);
  });

  it("follows the Conductor's look on a conductor-role thread in another channel, not that channel's", () => {
    const line = label(ctx({ thread: { ...thread, channel_id: 'acme' }, ch: { ...conductor(), id: 'acme', name: 'acme', icon: '🛍️' }, conductorChannel: conductor() }));
    expect(line).toContain(CHARACTER);
    expect(line).not.toContain('🛍️');
  });
});

describe("an Ask's thread on the phone", () => {
  const kid = (id: string) => ({ ...thread, id, channel_id: 'conductor', role: 'hermes-box', parent_id: 'lead', status: 'done', task_id: 'T-1' }) as Thread;
  const ask = { thread_id: 'asked', role: 'hermes-box', name: 'Hermes on box', harness: 'custom:hermes-box', harness_name: 'Hermes on box', remote: true, question: 'Check it', excerpt: null, wake: true, title: 'Ask: Check it', channel: 'conductor' };
  const card = (t: TurnView) => renderToStaticMarkup(createElement(Turn, { t, first: true, last: true, c: ctx() }));

  it('names the role the Ask went to, and that it is remote, as the desktop card does', () => {
    const markup = card({ ...turn, children: [kid('asked')], asks: [ask] });
    expect(markup).toContain('Asked Hermes on box');
    expect(markup).toContain('Remote');
    expect(markup).not.toContain('Delegated 1 task');
  });

  it('keeps Delegated for a turn whose threads did not all come from an Ask', () => {
    const markup = card({ ...turn, children: [kid('asked'), kid('other')], asks: [ask] });
    expect(markup).toContain('Delegated 2 tasks');
    expect(markup).not.toContain('Asked Hermes on box</');
  });
});
