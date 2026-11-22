import { describe, expect, it } from 'vitest';
import {
  CHANNEL_GLYPHS, channelFace, hasOwnLook, parseChannelIcon, readSvgIcon, sameIcon, scaleSvgIcon, SVG_MAX, SVG_SCALE_DEFAULT, svgIconScalable, svgIconScale,
} from '../channel-icon.ts';

import { ICON_PATHS, type IconName } from '../icons.ts';

CHANNEL_GLYPHS satisfies readonly IconName[];

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
    for (const name of CHANNEL_GLYPHS) expect(ICON_PATHS[name]).toEqual(expect.any(String));
  });
});

describe('channel faces', () => {
  it('draws the Omni mark for the Conductor only while it has no icon of its own', () => {
    expect(channelFace(null, true)).toEqual({ kind: 'omni' });
    expect(channelFace('', true)).toEqual({ kind: 'omni' });
    expect(channelFace('icon:nope', true)).toEqual({ kind: 'omni' });
    expect(channelFace('icon:target', true)).toEqual({ kind: 'glyph', name: 'target' });
    expect(channelFace('🎼', true)).toEqual({ kind: 'emoji', text: '🎼' });
  });

  it('draws any other channel its icon or its monogram', () => {
    expect(channelFace('icon:terminal')).toEqual({ kind: 'glyph', name: 'terminal' });
    expect(channelFace(null)).toEqual({ kind: 'letters' });
  });

  it('tells a saved look from the defaults', () => {
    expect(hasOwnLook({ icon: null, avatar_bg: null })).toBe(false);
    expect(hasOwnLook({})).toBe(false);
    expect(hasOwnLook({ icon: 'icon:target', avatar_bg: null })).toBe(true);
    expect(hasOwnLook({ icon: null, avatar_bg: '#283c62' })).toBe(true);
    expect(hasOwnLook({ icon: 'icon:nope', avatar_bg: '' })).toBe(false);
  });
});

describe('SVG icon size', () => {
  const file = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 128 128" width="128" height="128"><circle r="60"/></svg>';

  it('defaults to the size it was uploaded at', () => {
    expect(svgIconScale(file)).toBe(SVG_SCALE_DEFAULT);
    expect(svgIconScale('<svg viewBox="0 0 24 24" data-omni-scale="nonsense"></svg>')).toBe(SVG_SCALE_DEFAULT);
    expect(svgIconScale('<svg viewBox="0 0 24 24" data-omni-scale="900"></svg>')).toBe(SVG_SCALE_DEFAULT);
  });

  it('saves the size in the markup around the centre, and keeps it through a save and a read', () => {
    const smaller = scaleSvgIcon(file, 80);
    expect(smaller).toBe('<svg data-omni-scale="80" data-omni-viewbox="-64 -64 128 128" xmlns="http://www.w3.org/2000/svg" viewBox="-80 -80 160 160" width="128" height="128"><circle r="60"/></svg>');
    expect(svgIconScale(smaller)).toBe(80);
    const stored = readSvgIcon(smaller);
    expect(parseChannelIcon(stored)).toEqual({ kind: 'svg', markup: smaller });

    const bigger = scaleSvgIcon(smaller, 125);
    expect(svgIconScale(bigger)).toBe(125);
    expect(bigger).toContain('viewBox="-51.2 -51.2 102.4 102.4"');
    expect(bigger).toContain('data-omni-viewbox="-64 -64 128 128"');
  });

  it('puts the file back exactly as uploaded at the default size', () => {
    expect(scaleSvgIcon(scaleSvgIcon(scaleSvgIcon(file, 60), 140), SVG_SCALE_DEFAULT)).toBe(file);
    expect(scaleSvgIcon(file, SVG_SCALE_DEFAULT)).toBe(file);
  });

  it('sizes a file with only a width and height, and drops the viewBox it added on reset', () => {
    const plain = "<svg width='24px' height='12'><rect/></svg>";
    expect(svgIconScalable(plain)).toBe(true);
    const half = scaleSvgIcon(plain, 50);
    expect(half).toContain('viewBox="-12 -6 48 24"');
    expect(svgIconScale(half)).toBe(50);
    expect(scaleSvgIcon(half, SVG_SCALE_DEFAULT)).toBe(plain);
  });

  it('counts a resized SVG as the same icon', () => {
    expect(sameIcon(`svg:${file}`, `svg:${scaleSvgIcon(file, 70)}`)).toBe(true);
    expect(sameIcon(`svg:${scaleSvgIcon(file, 130)}`, `svg:${scaleSvgIcon(file, 70)}`)).toBe(true);
    expect(sameIcon(`svg:${file}`, 'svg:<svg viewBox="0 0 1 1"></svg>')).toBe(false);
    expect(sameIcon('icon:target', 'icon:target')).toBe(true);
    expect(sameIcon('icon:target', '🍋')).toBe(false);
  });

  it('clamps to the range and leaves a file without a box alone', () => {
    expect(svgIconScale(scaleSvgIcon(file, 10))).toBe(50);
    expect(svgIconScale(scaleSvgIcon(file, 999))).toBe(150);
    const boxless = '<svg width="100%"><rect/></svg>';
    expect(svgIconScalable(boxless)).toBe(false);
    expect(scaleSvgIcon(boxless, 80)).toBe(boxless);
  });
});
