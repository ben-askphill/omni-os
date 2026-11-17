import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({
  channels: [] as { id: string; name: string; icon: string | null; avatar_bg: string | null }[],
}));

vi.mock('../src/store.tsx', () => ({
  useApp: () => ({ channels: state.channels }),
}));

import { ChannelStack } from '../src/components/ChannelStack.tsx';

const kid = (channel_id: string, status = 'done') => ({ channel_id, status });
const render = (threads: { channel_id: string; status: string }[], own = 'conductor') =>
  renderToStaticMarkup(createElement(ChannelStack, { threads, own, to: '#/t/job/details' }));
const discs = (html: string) => [...html.matchAll(/data-channel="([^"]+)"/g)].map((m) => m[1]);

describe('ChannelStack', () => {
  state.channels = [
    { id: 'omni-os', name: 'omni-os', icon: 'terminal', avatar_bg: null },
    { id: 'volero', name: 'Volero', icon: null, avatar_bg: '#283c62' },
    { id: 'patta', name: 'Patta', icon: null, avatar_bg: null },
    { id: 'acne', name: 'Acne Studios', icon: null, avatar_bg: null },
    { id: 'pink', name: 'Pink Gellac', icon: null, avatar_bg: null },
  ];

  it('renders nothing for a thread that delegated nothing, or only into its own channel', () => {
    expect(render([])).toBe('');
    expect(render([kid('conductor'), kid('conductor', 'running')])).toBe('');
  });

  it("draws each channel once with the sidebar's face, ringed in the page colour, overlapping from the second", () => {
    const html = render([kid('omni-os', 'running'), kid('volero'), kid('omni-os'), kid('volero')]);
    expect(discs(html)).toEqual(['omni-os', 'volero']);
    expect(html).toContain('data-channel-stack="2"');
    expect(html.match(/ring-2 ring-bg/g)).toHaveLength(2);
    expect(html).toContain('background-color:#283c62;color:#ffffff');
    expect(html.match(/margin-left:-7px/g)).toHaveLength(1);
    expect(html).not.toContain('data-channel-more');
    expect(html).toContain('href="#/t/job/details"');
    expect(html).toContain('title="Delegated to 2 channels: #omni-os (2 threads, 1 working), #Volero (2 threads)"');
  });

  it('shows a single channel', () => {
    expect(discs(render([kid('patta')]))).toEqual(['patta']);
  });

  it('caps the stack at four discs, the last a +N chip, and still names every channel', () => {
    const html = render(['omni-os', 'volero', 'patta', 'acne', 'pink', 'gone'].map((c) => kid(c)));
    expect(discs(html)).toEqual(['omni-os', 'volero', 'patta']);
    expect(html).toContain('data-channel-more="3"');
    expect(html).toContain('>+3</span>');
    expect(html).toContain('#Acne Studios, #Pink Gellac, #gone');
  });
});
