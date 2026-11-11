import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ channels: [] as { id: string; name: string; kind: string; icon: string | null; avatar_bg: string | null; running: number }[] }));

vi.mock('../src/store.tsx', () => ({ useApp: () => ({ channels: state.channels, needsYou: null, profile: null }) }));

import { ChannelRail } from '../src/components/rail/ChannelRail.tsx';

const disc = (html: string, label: string) => {
  const at = html.indexOf(`aria-label="${label}"`);
  return html.slice(at, html.indexOf('</a>', at));
};

describe('ChannelRail', () => {
  it("paints a channel's disc with its avatar background, selected or not, and falls back to the neutral disc without one", () => {
    state.channels = [
      { id: 'acne', name: 'Acne Studios', kind: 'client', icon: null, avatar_bg: '#e6a491', running: 0 },
      { id: 'volero', name: 'Volero', kind: 'client', icon: null, avatar_bg: '#283c62', running: 0 },
      { id: 'plain', name: 'Plain', kind: 'client', icon: null, avatar_bg: null, running: 0 },
    ];
    const html = renderToStaticMarkup(createElement(ChannelRail, { selection: { kind: 'channel', id: 'acne' } }));
    expect(disc(html, 'Acne Studios')).toContain('background-color:#e6a491;color:#202020');
    expect(disc(html, 'Acne Studios')).toContain('ring-2');
    expect(disc(html, 'Volero')).toContain('background-color:#283c62;color:#ffffff');
    expect(disc(html, 'Plain')).not.toContain('background-color');
    expect(disc(html, 'Plain')).toContain('bg-surface-2');
  });

  it('marks one item current: a channel named Inbox never shares the Inbox selection', () => {
    state.channels = [{ id: 'inbox', name: 'Inbox', kind: 'internal', icon: null, avatar_bg: null, running: 0 }];
    const current = (html: string) => html.match(/aria-current="page"/g)?.length ?? 0;
    const onInbox = renderToStaticMarkup(createElement(ChannelRail, { selection: { kind: 'inbox' } }));
    expect(current(onInbox)).toBe(1);
    expect(disc(onInbox, 'Inbox')).toContain('aria-current="page"');
    const onChannel = renderToStaticMarkup(createElement(ChannelRail, { selection: { kind: 'channel', id: 'inbox' } }));
    expect(current(onChannel)).toBe(1);
  });
});
