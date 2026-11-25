// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Channel } from '../src/api.ts';
import type { Template, TemplateList } from '@omni/shared/templates.ts';

// The template chips under an empty new-thread box: a channel page's composer shows them, Overview's leaves them out
// (and does not ask for the list), so nothing sits between its composer and the tiles.

const state = vi.hoisted(() => ({ channels: [] as Channel[], crew: [] }));
vi.mock('../src/store.tsx', () => ({ useApp: () => ({ ...state, status: null }), useHereName: () => undefined, useFeed: () => {} }));

import { NewThreadComposer } from '../src/components/Composer.tsx';

const template: Template = { id: 'meeting-agenda', name: 'Meeting agenda', description: 'An agenda.', kind: 'quick', pack: 'core', body: '$ARGUMENTS' };
const list: TemplateList = { templates: [template], shopify: false, hidden: 0 };

let root: Root;
let host: HTMLDivElement;
let asked: string[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  asked = [];
  state.channels = [
    { id: 'conductor', name: 'Conductor', kind: 'system' },
    { id: 'shop', name: 'Shop', kind: 'internal' },
  ] as Channel[];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      asked.push(url);
      if (url.startsWith('/api/templates')) return Response.json(list);
      if (url.startsWith('/api/harnesses')) return Response.json([]);
      if (url.startsWith('/api/commands')) return Response.json({ status: 'ready', commands: [] });
      return Response.json({ error: 'not here' }, { status: 404 });
    }),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 100))));
const chips = () => host.querySelector('[role="group"][aria-label="Templates"]');

describe('template chips under the new-thread composer', () => {
  it('shows them on a channel page', async () => {
    await act(async () => root.render(createElement(NewThreadComposer, { channelId: 'shop' })));
    await settle();
    expect(chips()?.textContent).toContain('Meeting agenda');
  });

  it("leaves them out of Overview's composer, without asking for the list", async () => {
    await act(async () => root.render(createElement(NewThreadComposer, { big: true, templateChips: false })));
    await settle();
    expect(chips()).toBeNull();
    expect(asked.some((u) => u.startsWith('/api/templates'))).toBe(false);
  });
});
