// A channel's icon: one emoji, or one of the design system's icons stored as `icon:<name>`. The server checks
// it with parseChannelIcon; the Web UI and the Mac app draw it. OmniKit's ChannelIcon keeps the same list.

/** The design system icons a channel can wear, in picker order. Names are keys of PATHS in web/src/components/ui.tsx. */
export const CHANNEL_GLYPHS = [
  'hash', 'home', 'inbox', 'message', 'bell', 'globe', 'browser', 'terminal', 'branch', 'pr', 'diff', 'file',
  'image', 'layers', 'grid', 'archive', 'key', 'lock', 'zap', 'target', 'gauge', 'clock', 'sun', 'moon',
  'monitor', 'tool', 'sliders', 'search', 'delegate', 'switchboard', 'split', 'refresh', 'alert', 'info', 'check', 'play',
] as const;

export type ChannelGlyph = (typeof CHANNEL_GLYPHS)[number];

export const GLYPH_PREFIX = 'icon:';

export type ChannelIcon = { kind: 'glyph'; name: ChannelGlyph } | { kind: 'emoji'; text: string };

const graphemes = new Intl.Segmenter();

/** What a stored icon draws, or null for none (the letter avatar) or a value that is neither. */
export function parseChannelIcon(value: string | null | undefined): ChannelIcon | null {
  const v = value?.trim();
  if (!v) return null;
  if (v.startsWith(GLYPH_PREFIX)) {
    const name = v.slice(GLYPH_PREFIX.length);
    return (CHANNEL_GLYPHS as readonly string[]).includes(name) ? { kind: 'glyph', name: name as ChannelGlyph } : null;
  }
  return [...graphemes.segment(v)].length === 1 ? { kind: 'emoji', text: v } : null;
}

export const glyphIcon = (name: ChannelGlyph) => `${GLYPH_PREFIX}${name}`;
