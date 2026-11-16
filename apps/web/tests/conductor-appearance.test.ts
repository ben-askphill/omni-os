import { describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The Conductor's look is the user's: the Omni mark is only its default, drawn while it has no icon or background of
// its own. A saved icon and background win wherever the Conductor shows.
const state = vi.hoisted(() => ({
  channels: [] as { id: string; name: string; kind: string; icon: string | null; avatar_bg: string | null; running: number }[],
}));

vi.mock('../src/store.tsx', () => ({
  useApp: () => ({ channels: state.channels, needsYou: null, profile: null }),
  readPref: (_key: string, fallback: unknown) => fallback,
  writePref: () => {},
}));

import { Avatar } from '../src/components/ui.tsx';
import { ChannelRail } from '../src/components/rail/ChannelRail.tsx';
import { channelAvatar } from '../src/components/composer/pickerOptions.tsx';

const html = (node: ReactNode) => renderToStaticMarkup(createElement('div', null, node));
const OMNI_MARK = 'class="mark ';
const conductor = (over: { icon?: string | null; avatar_bg?: string | null } = {}) => ({ id: 'conductor', name: 'Conductor', kind: 'system', icon: null, avatar_bg: null, running: 0, ...over });
const railDisc = (markup: string) => {
  const at = markup.indexOf('aria-label="Conductor"');
  return markup.slice(at, markup.indexOf('</a>', at));
};

describe("the Conductor's avatar", () => {
  it('draws the Omni mark by default', () => {
    expect(html(createElement(Avatar, { name: 'Conductor', omni: true }))).toContain(OMNI_MARK);
    expect(html(createElement(Avatar, { name: 'Conductor', omni: true, channelIcon: '' }))).toContain(OMNI_MARK);
  });

  it('draws the icon saved for it instead, on the background saved for it', () => {
    const glyph = html(createElement(Avatar, { name: 'Conductor', omni: true, channelIcon: 'icon:target', avatarBg: '#ffffff' }));
    expect(glyph).not.toContain(OMNI_MARK);
    expect(glyph).toContain('<svg');
    expect(glyph).toContain('background-color:#ffffff');
    const emoji = html(createElement(Avatar, { name: 'Conductor', omni: true, channelIcon: '🎼' }));
    expect(emoji).not.toContain(OMNI_MARK);
    expect(emoji).toContain('🎼');
  });

  it('keeps the Omni mark on a background saved without an icon', () => {
    const markup = html(createElement(Avatar, { name: 'Conductor', omni: true, avatarBg: '#283c62' }));
    expect(markup).toContain(OMNI_MARK);
    expect(markup).toContain('background-color:#283c62');
  });

  it('leaves other channels on their monogram', () => {
    expect(html(createElement(Avatar, { name: 'Acme' }))).not.toContain(OMNI_MARK);
  });
});

describe("the Conductor's rail disc", () => {
  it('shows the Omni mark on the neutral disc by default', () => {
    state.channels = [conductor()];
    const disc = railDisc(renderToStaticMarkup(createElement(ChannelRail, { selection: { kind: 'inbox' } })));
    expect(disc).toContain(OMNI_MARK);
    expect(disc).not.toContain('background-color');
  });

  it('shows the saved icon and background', () => {
    state.channels = [conductor({ icon: 'icon:target', avatar_bg: '#283c62' })];
    const disc = railDisc(renderToStaticMarkup(createElement(ChannelRail, { selection: { kind: 'inbox' } })));
    expect(disc).not.toContain(OMNI_MARK);
    expect(disc).toContain('background-color:#283c62');
  });
});

describe("the Conductor in a channel picker", () => {
  it('leads with the bare Omni mark by default', () => {
    const option = channelAvatar(conductor() as never);
    expect(option.lead).toBeTruthy();
    expect(html(option.lead)).toContain(OMNI_MARK);
  });

  it('draws its avatar with the saved icon and background once it has them', () => {
    const option = channelAvatar(conductor({ icon: 'icon:target', avatar_bg: '#ffffff' }) as never);
    expect(option).toMatchObject({ lead: undefined, omni: true, channelIcon: 'icon:target', avatarBg: '#ffffff' });
  });

  it('gives other channels their own icon and background, never the Omni mark', () => {
    const option = channelAvatar({ id: 'acme', name: 'Acme', kind: 'client', icon: '🛍️', avatar_bg: '#e8d9f5', running: 0 } as never);
    expect(option).toMatchObject({ lead: undefined, omni: false, channelIcon: '🛍️', avatarBg: '#e8d9f5' });
  });
});
