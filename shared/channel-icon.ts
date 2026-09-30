// A channel's icon: one emoji, one of the design system's icons stored as `icon:<name>`, or an uploaded SVG stored
// as `svg:<markup>`. The server checks it with parseChannelIcon; the Web UI and the Mac app draw it. OmniKit's
// ChannelIcon keeps the same list. An SVG is only ever drawn as an image (an <img> data URL, an NSImage), never
// put into the page as markup, so scripts in it could not run anyway; readSvgIcon refuses them all the same.

/** The design system icons a channel can wear, in picker order. Names are keys of PATHS in web/src/components/ui.tsx. */
export const CHANNEL_GLYPHS = [
  'hash', 'home', 'inbox', 'message', 'bell', 'globe', 'browser', 'terminal', 'branch', 'pr', 'diff', 'file',
  'image', 'layers', 'grid', 'archive', 'key', 'lock', 'zap', 'target', 'gauge', 'clock', 'sun', 'moon',
  'monitor', 'tool', 'sliders', 'search', 'delegate', 'switchboard', 'split', 'refresh', 'alert', 'info', 'check', 'play',
] as const;

export type ChannelGlyph = (typeof CHANNEL_GLYPHS)[number];

export const GLYPH_PREFIX = 'icon:';
export const SVG_PREFIX = 'svg:';
/** The most an uploaded SVG may hold once comments and the XML prolog are gone, in characters. */
export const SVG_MAX = 20_000;

export type ChannelIcon =
  | { kind: 'glyph'; name: ChannelGlyph }
  | { kind: 'emoji'; text: string }
  | { kind: 'svg'; markup: string };

// Anything that could run, load from elsewhere or expand: scripts, embedded HTML, event handlers, javascript:
// URLs, links and CSS urls that leave the file, entities. A data:image URL and a #fragment stay.
const SVG_REFUSED = [
  /<\s*(script|foreignObject|iframe|embed|object|audio|video|link|meta)\b/i,
  /<!(DOCTYPE|ENTITY)/i,
  /\son[a-z]+\s*=/i,
  /javascript:/i,
  /@import/i,
  /\b(?:xlink:)?href\s*=\s*["']?\s*(?!#|data:image\/)[^\s"'>]/i,
  /url\(\s*["']?\s*(?!#|data:image\/)[^\s"')]/i,
];

/**
 * A file's text as the `svg:` value to store, without its BOM, XML prolog and comments. Throws, with a message
 * to show, for a file that is not one SVG, is too big, or holds anything that could run or load.
 */
export function readSvgIcon(text: string): string {
  const markup = text
    .replace(/^\uFEFF/, '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  if (!/^<svg[\s>]/i.test(markup) || !/<\/svg>$/i.test(markup)) throw new Error('That file is not an SVG.');
  if (markup.length > SVG_MAX) throw new Error(`That SVG is too big: keep it under ${SVG_MAX / 1000} KB.`);
  if (SVG_REFUSED.some((re) => re.test(markup))) throw new Error('That SVG has scripts, links or embedded content. Export a plain one.');
  return `${SVG_PREFIX}${markup}`;
}

/** An SVG icon as an image URL, for <img src>. */
export const svgDataUrl = (markup: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

const graphemes = new Intl.Segmenter();

/** What a stored icon draws, or null for none (the letter avatar) or a value that is neither. */
export function parseChannelIcon(value: string | null | undefined): ChannelIcon | null {
  const v = value?.trim();
  if (!v) return null;
  if (v.startsWith(SVG_PREFIX)) {
    try {
      return { kind: 'svg', markup: readSvgIcon(v.slice(SVG_PREFIX.length)).slice(SVG_PREFIX.length) };
    } catch {
      return null;
    }
  }
  if (v.startsWith(GLYPH_PREFIX)) {
    const name = v.slice(GLYPH_PREFIX.length);
    return (CHANNEL_GLYPHS as readonly string[]).includes(name) ? { kind: 'glyph', name: name as ChannelGlyph } : null;
  }
  return [...graphemes.segment(v)].length === 1 ? { kind: 'emoji', text: v } : null;
}

export const glyphIcon = (name: ChannelGlyph) => `${GLYPH_PREFIX}${name}`;
