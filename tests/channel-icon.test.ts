import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANNEL_GLYPHS, parseChannelIcon, readSvgIcon, SVG_MAX } from '../shared/channel-icon.ts';

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

  it('keeps a plain SVG, without its prolog and comments', () => {
    const file = '\uFEFF<?xml version="1.0"?>\n<!-- Illustrator -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g"/></defs><circle fill="url(#g)" r="10"/><use href="#g"/><image href="data:image/png;base64,AAAA"/></svg>\n';
    const value = readSvgIcon(file);
    expect(value).toBe('svg:<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g"/></defs><circle fill="url(#g)" r="10"/><use href="#g"/><image href="data:image/png;base64,AAAA"/></svg>');
    expect(parseChannelIcon(value)).toEqual({ kind: 'svg', markup: value.slice(4) });
  });

  it('refuses SVGs that could run, load or are not SVGs', () => {
    const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
    const refused = [
      wrap('<script>alert(1)</script>'),
      wrap('<foreignObject><div/></foreignObject>'),
      '<svg onload="alert(1)"></svg>',
      wrap('<a href="javascript:alert(1)"><circle r="1"/></a>'),
      wrap('<image href="https://example.com/x.png"/>'),
      wrap('<use xlink:href="other.svg#a"/>'),
      wrap('<rect style="fill:url(https://example.com/p)"/>'),
      wrap('<style>@import "x.css";</style>'),
      '<!DOCTYPE svg [<!ENTITY a "b">]><svg></svg>',
      '<html><svg></svg></html>',
      'not an svg',
      wrap(`<path d="${'M0 0'.repeat(SVG_MAX)}"/>`),
    ];
    for (const s of refused) {
      expect(() => readSvgIcon(s), s.slice(0, 60)).toThrow();
      expect(parseChannelIcon(`svg:${s}`)).toBeNull();
    }
  });

  it('offers only icons the Web UI draws', () => {
    const ui = readFileSync(resolve(root, 'web/src/components/ui/icons.tsx'), 'utf8');
    for (const name of CHANNEL_GLYPHS) expect(ui, name).toMatch(new RegExp(`^  ${name}: '`, 'm'));
  });

  it('matches the list in the Mac app', () => {
    const swift = readFileSync(resolve(root, 'mac/OmniKit/Sources/OmniKit/ChannelIcon.swift'), 'utf8');
    const list = swift.match(/glyphs: \[String\] = \[([^\]]*)\]/)![1];
    expect([...list.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1])).toEqual([...CHANNEL_GLYPHS]);
  });
});
