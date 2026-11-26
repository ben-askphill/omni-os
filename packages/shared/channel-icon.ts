// A channel's icon: one emoji, one of the design system's icons stored as `icon:<name>`, or an uploaded SVG stored
// as `svg:<markup>`. The server checks it with parseChannelIcon; the Web UI draws it. An SVG is only ever drawn as an
// image (an <img> data URL), never put into the page as markup, so scripts in it could not run anyway; readSvgIcon
// refuses them all the same.

/** The design system icons a channel can wear, in picker order. Names are keys of PATHS in apps/web/src/components/ui.tsx. */
export const CHANNEL_GLYPHS = [
  'hash', 'home', 'inbox', 'message', 'bell', 'globe', 'browser', 'terminal', 'branch', 'pr', 'diff', 'file',
  'image', 'layers', 'grid', 'archive', 'key', 'lock', 'zap', 'target', 'gauge', 'clock', 'sun', 'moon',
  'monitor', 'tool', 'sliders', 'search', 'delegate', 'switchboard', 'split', 'refresh', 'alert', 'info', 'check', 'play',
] as const;

export type ChannelGlyph = (typeof CHANNEL_GLYPHS)[number];

export const GLYPH_PREFIX = 'icon:';
export const SVG_PREFIX = 'svg:';
/** The most an uploaded SVG may hold once comments, XML prolog and `<metadata>` blocks are gone, in characters. */
export const SVG_MAX = 20_000;

export type ChannelIcon =
  | { kind: 'glyph'; name: ChannelGlyph }
  | { kind: 'emoji'; text: string }
  | { kind: 'svg'; markup: string };

// Embedded SVG metadata blocks (C2PA manifests, XMP/RDF blocks from Illustrator/Photoshop/Inkscape, etc.) add
// tens of kilobytes without affecting rendering.
const SVG_METADATA = /<\s*(?:svg:)?metadata(?:\s(?:"[^"]*"|'[^']*'|[^>"'/])*)?\s*(?:\/>|>[\s\S]*?<\s*\/\s*(?:svg:)?metadata\s*>)/gi;

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
 * A file's text as the `svg:` value to store, without its BOM, XML prolog, comments and `<metadata>` blocks.
 * Throws, with a message to show, for a file that is not one SVG, is too big, or holds anything that could run or load.
 */
export function readSvgIcon(text: string): string {
  const markup = text
    .replace(/^\uFEFF/, '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(SVG_METADATA, '')
    .trim();
  if (!/^<svg[\s>]/i.test(markup) || !/<\/svg>$/i.test(markup)) throw new Error('That file is not an SVG.');
  if (markup.length > SVG_MAX) throw new Error(`That SVG is too big: keep it under ${SVG_MAX / 1000} KB.`);
  if (SVG_REFUSED.some((re) => re.test(markup))) throw new Error('That SVG has scripts, links or embedded content. Export a plain one.');
  return `${SVG_PREFIX}${markup}`;
}

// An uploaded SVG's size in its avatar. The size lives in the markup itself: the root's viewBox is widened (smaller) or
// narrowed (bigger) around its centre, and the file's own viewBox and the percent ride along as data attributes so
// the size can change again. Every client already draws the stored markup, so the size reaches all of them, older
// versions included, with nothing else to store or sync. 100 puts the file back exactly as uploaded.

export const SVG_SCALE_DEFAULT = 100;
export const SVG_SCALE_MIN = 50;
export const SVG_SCALE_MAX = 150;
export const SVG_SCALE_STEP = 5;

const ROOT_TAG = /^<svg\b[^>]*>/i;
const attrRe = (name: string) => new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i');
const readAttr = (tag: string, name: string) => tag.match(attrRe(name))?.[2] ?? null;
const dropAttr = (tag: string, name: string) => tag.replace(attrRe(name), '');
const setAttr = (tag: string, name: string, value: string) =>
  attrRe(name).test(tag) ? tag.replace(attrRe(name), ` ${name}="${value}"`) : tag.replace(/^<svg\b/i, `<svg ${name}="${value}"`);

/** A root width or height that gives a box: a plain number or px, not a percent or another unit. */
const plainLength = (v: string | null) => (v && /^\s*[\d.]+\s*(px)?\s*$/i.test(v) ? Number.parseFloat(v) : Number.NaN);

/** The box the file was drawn in, as uploaded: its viewBox, else its width and height. Null when it has neither. */
function baseBox(tag: string): [number, number, number, number] | null {
  const raw = readAttr(tag, 'data-omni-viewbox') ?? readAttr(tag, 'viewBox');
  if (raw) {
    const n = raw.trim().split(/[\s,]+/).map(Number);
    return n.length === 4 && n.every(Number.isFinite) && n[2] > 0 && n[3] > 0 ? (n as [number, number, number, number]) : null;
  }
  const w = plainLength(readAttr(tag, 'width'));
  const h = plainLength(readAttr(tag, 'height'));
  return w > 0 && h > 0 ? [0, 0, w, h] : null;
}

/** Whether an SVG has a box to size within. One without a viewBox, width or height cannot be sized. */
export const svgIconScalable = (markup: string) => !!baseBox(markup.match(ROOT_TAG)?.[0] ?? '');

/** An uploaded SVG's saved size, in percent of the file as uploaded. */
export function svgIconScale(markup: string): number {
  const tag = markup.match(ROOT_TAG)?.[0] ?? '';
  const n = Number(readAttr(tag, 'data-omni-scale'));
  return Number.isFinite(n) && n >= SVG_SCALE_MIN && n <= SVG_SCALE_MAX && baseBox(tag) ? n : SVG_SCALE_DEFAULT;
}

const round = (n: number) => Number(n.toFixed(3)).toString();

/** The SVG drawn at `percent` of its uploaded size, clamped to the range. Markup it cannot size comes back unchanged. */
export function scaleSvgIcon(markup: string, percent: number): string {
  const tag = markup.match(ROOT_TAG)?.[0];
  const box = tag && baseBox(tag);
  if (!tag || !box) return markup;
  const p = Math.min(SVG_SCALE_MAX, Math.max(SVG_SCALE_MIN, Math.round(percent)));
  const uploaded = readAttr(tag, 'data-omni-viewbox');
  let next = dropAttr(dropAttr(tag, 'data-omni-scale'), 'data-omni-viewbox');
  if (p === SVG_SCALE_DEFAULT) {
    // Back to the file as it came: its own viewBox, or none when it had only a width and height.
    next = uploaded === '' ? dropAttr(next, 'viewBox') : uploaded ? setAttr(next, 'viewBox', uploaded) : next;
  } else {
    const [x, y, w, h] = box;
    const f = SVG_SCALE_DEFAULT / p;
    const vb = [x + (w - w * f) / 2, y + (h - h * f) / 2, w * f, h * f].map(round).join(' ');
    next = setAttr(setAttr(setAttr(next, 'viewBox', vb), 'data-omni-viewbox', uploaded ?? readAttr(tag, 'viewBox') ?? ''), 'data-omni-scale', String(p));
  }
  return next + markup.slice(tag.length);
}

/**
 * Whether two stored icons are the same icon, a size apart at most. A resized SVG is not a new icon: it keeps its
 * automatic background instead of rolling a new one.
 */
export function sameIcon(a: string | null | undefined, b: string | null | undefined): boolean {
  const unsized = (v: string | null | undefined) => {
    const t = v?.trim() ?? '';
    if (!t.startsWith(SVG_PREFIX)) return t;
    const parsed = parseChannelIcon(t);
    const markup = parsed?.kind === 'svg' ? parsed.markup : t.slice(SVG_PREFIX.length);
    return scaleSvgIcon(markup, SVG_SCALE_DEFAULT);
  };
  return unsized(a) === unsized(b);
}

/** An SVG icon as an image URL, for <img src>. */
export const svgDataUrl = (markup: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

// Hermes, the iPhone app's engine, has no Intl.Segmenter. The server checked the value when it was saved, so a
// client without one draws what it is given.
const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : null;
const isOneGrapheme = (s: string) => !graphemes || [...graphemes.segment(s)].length === 1;

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
  return isOneGrapheme(v) ? { kind: 'emoji', text: v } : null;
}

export const glyphIcon = (name: ChannelGlyph) => `${GLYPH_PREFIX}${name}`;

/** The Conductor's channel, a system channel every install has (apps/server/db/repos/channels.ts). */
export const CONDUCTOR_CHANNEL = 'conductor';

/**
 * What a channel's avatar draws: its own icon when it has one, the Omni mark for the Conductor, else its monogram.
 * The Omni mark is only the Conductor's default: an icon picked in its settings wins on every client.
 */
export type ChannelFace = ChannelIcon | { kind: 'omni' } | { kind: 'letters' };

export function channelFace(icon: string | null | undefined, conductor = false): ChannelFace {
  return parseChannelIcon(icon) ?? (conductor ? { kind: 'omni' } : { kind: 'letters' });
}

/**
 * Whether the channel has a look of its own: an icon or a background. Without one, the Conductor shows its bare Omni
 * mark where other channels show a #, which in places moves with what it is doing.
 */
export const hasOwnLook = (c: { icon?: string | null; avatar_bg?: string | null }) => !!c.avatar_bg || !!parseChannelIcon(c.icon);
