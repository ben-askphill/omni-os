import { CHANNEL_GLYPHS, glyphIcon, readSvgIcon } from '@omni/shared/channel-icon.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { channelFace } from '../src/components/channel-face';
import { SYMBOLS } from '../src/ui/symbols';

const SVG_FILE = '<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>.a{fill:#e11}</style><circle class="a" cx="12" cy="12" r="10"/></svg>';

describe('what a channel avatar draws', () => {
  it('draws an emoji the computer saved', () => {
    expect(channelFace('shop', '🛍️')).toEqual({ kind: 'emoji', text: '🛍️' });
    expect(channelFace('team', '👩‍💻')).toEqual({ kind: 'emoji', text: '👩‍💻' });
  });

  it('draws a design system icon, and every icon the computer offers has an SF Symbol', () => {
    expect(channelFace('ops', glyphIcon('zap'))).toEqual({ kind: 'glyph', name: 'zap' });
    for (const name of CHANNEL_GLYPHS) {
      const face = channelFace('x', glyphIcon(name));
      expect(face).toEqual({ kind: 'glyph', name });
      expect(SYMBOLS[name as keyof typeof SYMBOLS], name).toEqual(expect.any(String));
    }
  });

  it('draws an uploaded SVG as the server stored it, without the prolog and comments', () => {
    const face = channelFace('brand', readSvgIcon(SVG_FILE));
    expect(face).toEqual({ kind: 'svg', markup: expect.stringMatching(/^<svg[\s\S]*<\/svg>$/) });
    expect(face.kind === 'svg' && face.markup).not.toMatch(/<\?xml|<!--/);
  });

  it('falls back to the first letter for no icon, an unknown icon or an SVG that could run or load', () => {
    expect(channelFace('acme-store', null)).toEqual({ kind: 'letter', letter: 'A' });
    expect(channelFace('acme', '  ')).toEqual({ kind: 'letter', letter: 'A' });
    expect(channelFace('acme', 'icon:not-a-glyph')).toEqual({ kind: 'letter', letter: 'A' });
    expect(channelFace('acme', 'svg:<svg><script>alert(1)</script></svg>')).toEqual({ kind: 'letter', letter: 'A' });
    expect(channelFace('acme', 'svg:<svg><image href="https://evil.example/x.png"/></svg>')).toEqual({ kind: 'letter', letter: 'A' });
    expect(channelFace('#!', null)).toEqual({ kind: 'letter', letter: '?' });
  });

  it('draws the Omni mark for the Conductor whatever its icon', () => {
    expect(channelFace('Conductor', '🚀', true)).toEqual({ kind: 'conductor' });
  });
});

describe('on an engine without Intl.Segmenter, as Hermes on the iPhone', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('loads and still draws an emoji, icon and SVG', async () => {
    vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
    vi.resetModules();
    const { channelFace: hermesFace } = await import('../src/components/channel-face');
    expect(hermesFace('shop', '👩‍💻')).toEqual({ kind: 'emoji', text: '👩‍💻' });
    expect(hermesFace('ops', 'icon:zap')).toEqual({ kind: 'glyph', name: 'zap' });
    expect(hermesFace('brand', readSvgIcon(SVG_FILE)).kind).toBe('svg');
  });
});
