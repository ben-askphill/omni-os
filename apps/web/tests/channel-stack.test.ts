import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({
  channels: [] as { id: string; name: string; icon: string | null; avatar_bg: string | null }[],
}));

vi.mock('../src/store.tsx', () => ({
  useApp: () => ({ channels: state.channels }),
}));

import { ChannelRollup, ChannelStack } from '../src/components/ChannelStack.tsx';

const kid = (channel_id: string, status = 'done') => ({ channel_id, status });
const render = (threads: { channel_id: string; status: string }[], own = 'conductor') =>
  renderToStaticMarkup(createElement(ChannelStack, { threads, own, to: '#/t/job/details' }));
const discs = (html: string) => [...html.matchAll(/data-channel="([^"]+)"/g)].map((m) => m[1]);
/** Each disc's and the +N chip's inline style, in order. */
const styles = (html: string) => [...html.matchAll(/<span[^>]*data-channel(?:-more)?="[^"]*"[^>]*>/g)].map((m) => /style="([^"]*)"/.exec(m[0])?.[1] ?? '');
const cut = (size: number) => {
  const o = Math.round(size * 0.28);
  return `radial-gradient(circle at ${o - size / 2}px 50%, transparent ${size / 2 + 1.5}px, #000 ${size / 2 + 2}px)`;
};

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

  it("draws each channel once with the sidebar's face, the first on top and each later one cut out under it", () => {
    const html = render([kid('omni-os', 'running'), kid('volero'), kid('omni-os'), kid('volero')]);
    expect(discs(html)).toEqual(['omni-os', 'volero']);
    expect(html).toContain('data-channel-stack="2"');
    // A transparent cut-out instead of a ring in one background colour.
    expect(html).not.toContain('ring-');
    const [first, second] = styles(html);
    expect(first).toBe('z-index:2');
    expect(second).toBe(`z-index:1;margin-left:-7px;-webkit-mask-image:${cut(24)};mask-image:${cut(24)}`);
    expect(html).toContain('background-color:#283c62;color:#ffffff');
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
    // The chip is a pill one overlap wider, cut like a disc, its count clear of the cut.
    expect(styles(html)[3]).toContain(`margin-left:-7px;-webkit-mask-image:${cut(24)};mask-image:${cut(24)};width:31px;height:24px;padding-left:7px`);
  });
});

describe('ChannelRollup', () => {
  const roll = (threads: { channel_id: string; status: string }[], props: { lead?: boolean; size?: number; fallback?: string } = {}) =>
    renderToStaticMarkup(createElement(ChannelRollup, { threads, own: 'conductor', size: props.size ?? 18, lead: props.lead, fallback: props.fallback }));

  it("keeps a job with nothing outside its channel as it was: the card's own avatar, nothing on a row", () => {
    expect(roll([], { lead: true, fallback: 'AVATAR' })).toBe('AVATAR');
    expect(roll([kid('conductor')], { lead: true, fallback: 'AVATAR' })).toBe('AVATAR');
    expect(roll([kid('conductor')])).toBe('');
  });

  it('leads with its own channel on the card, once, then each channel it delegated into, with a tooltip and no link', () => {
    const html = roll([kid('acne'), kid('conductor'), kid('volero', 'running'), kid('acne')], { lead: true });
    expect(discs(html)).toEqual(['conductor', 'acne', 'volero']);
    expect(html).toContain('data-channel-rollup="3"');
    expect(html).toContain('role="img"');
    expect(html).not.toContain('href=');
    expect(html).toContain('title="Works in 3 channels: #conductor, #Acne Studios (2 threads), #Volero (working)"');
    const [first, second, third] = styles(html);
    expect(first).toBe('z-index:3');
    expect(second).toContain(`margin-left:-5px;-webkit-mask-image:${cut(18)}`);
    expect(third).toContain('z-index:1');
  });

  it('leaves its own channel out on a row', () => {
    const html = roll([kid('conductor'), kid('acne'), kid('volero')], { size: 14 });
    expect(discs(html)).toEqual(['acne', 'volero']);
    expect(html).toContain('title="Delegated to 2 channels: #Acne Studios, #Volero"');
    expect(html).toContain('width:14px;height:14px');
  });

  it('writes the names out beside the discs on a phone row, where nothing hovers', () => {
    const html = renderToStaticMarkup(createElement(ChannelRollup, { threads: [kid('conductor'), kid('acne'), kid('volero')], own: 'conductor', size: 16, named: true }));
    expect(discs(html)).toEqual(['acne', 'volero']);
    expect(html).toContain('>Delegated to 2 channels: #Acne Studios, #Volero</span>');
    expect(html).not.toContain('title=');
    expect(html).not.toContain('role="img"');
  });

  it('caps at four discs on the card: its own channel, two more and a +N chip', () => {
    const html = roll(['acne', 'volero', 'pink', 'patta', 'omni-os'].map((c) => kid(c)), { lead: true });
    expect(discs(html)).toEqual(['conductor', 'acne', 'volero']);
    expect(html).toContain('data-channel-more="3"');
    expect(html).toContain('>+3</span>');
    expect(html).toContain('data-channel-rollup="6"');
  });
});
