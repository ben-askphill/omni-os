import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANNEL_GLYPHS, parseChannelIcon } from '../shared/channel-icon.ts';

const root = resolve(import.meta.dirname, '..');

describe('channel icons', () => {
  it('reads emoji, design system icons and nothing', () => {
    expect(parseChannelIcon('📸')).toEqual({ kind: 'emoji', text: '📸' });
    expect(parseChannelIcon(' 👩‍💻 ')).toEqual({ kind: 'emoji', text: '👩‍💻' });
    expect(parseChannelIcon('icon:terminal')).toEqual({ kind: 'glyph', name: 'terminal' });
    expect(parseChannelIcon('icon:nope')).toBeNull();
    expect(parseChannelIcon('KE')).toBeNull();
    expect(parseChannelIcon('')).toBeNull();
    expect(parseChannelIcon(null)).toBeNull();
  });

  it('offers only icons the Web UI draws', () => {
    const ui = readFileSync(resolve(root, 'web/src/components/ui.tsx'), 'utf8');
    for (const name of CHANNEL_GLYPHS) expect(ui, name).toMatch(new RegExp(`^  ${name}: '`, 'm'));
  });

  it('matches the list in the Mac app', () => {
    const swift = readFileSync(resolve(root, 'mac/OmniKit/Sources/OmniKit/ChannelIcon.swift'), 'utf8');
    const list = swift.match(/glyphs: \[String\] = \[([^\]]*)\]/)![1];
    expect([...list.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1])).toEqual([...CHANNEL_GLYPHS]);
  });
});
