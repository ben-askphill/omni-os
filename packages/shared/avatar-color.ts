import { parseChannelIcon } from './channel-icon.ts';

/** Opaque sRGB colors only, so stored values work on web and native clients. */
export function hexColor(value: string): string | null {
  const named: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', green: '#008000', yellow: '#ffff00', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', gray: '#808080', grey: '#808080' };
  const s = value.trim().toLowerCase();
  if (named[s]) return named[s];
  if (/^#[\da-f]{3}$/.test(s)) return '#' + [...s.slice(1)].map((c) => c + c).join('');
  if (/^#[\da-f]{6}$/.test(s)) return s;
  const rgb = /^rgb\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*\)$/.exec(s);
  return rgb && rgb.slice(1).every((n) => +n <= 255) ? '#' + rgb.slice(1).map((n) => (+n).toString(16).padStart(2, '0')).join('') : null;
}

export function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export const AVATAR_SWATCHES = ['#e8d9f5', '#d4e9fa', '#d3eee4', '#f5e6ba', '#f6d9cd', '#f0d8e3', '#283c62', '#354f42', '#573c65', '#733e35'];
export const avatarInk = (bg: string) => contrast(bg, '#202020') >= contrast(bg, '#ffffff') ? '#202020' : '#ffffff';
export function contrastingColor(foreground: string, random: () => number = Math.random): string {
  const choices = AVATAR_SWATCHES.filter((c) => contrast(c, foreground) >= 4.5);
  const colors = choices.length ? choices : ['#000000', '#ffffff'].filter((c) => contrast(c, foreground) >= 4.5);
  return colors[Math.min(colors.length - 1, Math.floor(Math.max(0, random()) * colors.length))];
}

/** Extract literal paint colors without a DOM, including inline styles and inherited root paint. Gradients and CSS variables are sampled in the browser. */
export function svgColors(markup: string): { palette: string[]; background: string | null; foreground: string } {
  const attr = (tag: string, key: string) => new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  const rawPaint = (tag: string, key: string) => new RegExp(`(?:^|[;"'])\\s*${key}\\s*:\\s*([^;"']+)`, 'i').exec(tag)?.[1] ?? attr(tag, key);
  const tags = markup.match(/<\/?[\w:-]+\b[^>]*>/g) ?? [];
  const root = tags[0] ?? '';
  const viewBox = attr(root, 'viewBox')?.trim().split(/[\s,]+/).map(Number);
  const w = viewBox?.[2] ?? Number(attr(root, 'width')), h = viewBox?.[3] ?? Number(attr(root, 'height'));
  const stack: { fill: string; stroke: string; hidden: boolean }[] = [{ fill: '#000000', stroke: 'none', hidden: false }];
  const shapes: { tag: string; fill: string | null; stroke: string | null }[] = [];
  const palette: string[] = [];
  for (const tag of tags) {
    if (tag.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
    const parent = stack[stack.length - 1];
    const fill = rawPaint(tag, 'fill') ?? parent.fill;
    const stroke = rawPaint(tag, 'stroke') ?? parent.stroke;
    const hidden = parent.hidden || /^<(defs|clipPath|mask|symbol)\b/i.test(tag) || attr(tag, 'opacity') === '0';
    for (const raw of [rawPaint(tag, 'fill'), rawPaint(tag, 'stroke')]) {
      const color = raw && hexColor(raw);
      if (color && !palette.includes(color)) palette.push(color);
    }
    if (!hidden && /^<(rect|circle|ellipse|path|polygon|polyline|text|line|use)\b/i.test(tag)) {
      shapes.push({ tag, fill: hexColor(fill), stroke: hexColor(stroke) });
    }
    if (!tag.endsWith('/>')) stack.push({ fill, stroke, hidden });
  }
  const first = shapes[0]?.tag ?? '';
  const full = (value: string | undefined, size: number) => value === '100%' || (Number.isFinite(size) && size > 0 && Number(value) >= size);
  const rect = /^<rect\b/i.test(first) && full(attr(first, 'width'), w) && full(attr(first, 'height'), h) && Number(attr(first, 'x') ?? 0) === (viewBox?.[0] ?? 0) && Number(attr(first, 'y') ?? 0) === (viewBox?.[1] ?? 0);
  const circle = /^<circle\b/i.test(first) && Number(attr(first, 'r')) >= Math.min(w, h) / 2 && Number(attr(first, 'cx')) === (viewBox?.[0] ?? 0) + w / 2 && Number(attr(first, 'cy')) === (viewBox?.[1] ?? 0) + h / 2;
  const background = rect || circle ? shapes[0]?.fill ?? null : null;
  const counts = new Map<string, number>();
  for (const shape of shapes) for (const c of [shape.fill, shape.stroke]) if (c && c !== background) counts.set(c, (counts.get(c) ?? 0) + 1);
  const foreground = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '#202020';
  return { palette, background, foreground };
}
export function autoAvatarColor(icon: string | null | undefined, random: () => number = Math.random): string | null {
  const mark = parseChannelIcon(icon);
  if (!mark) return null;
  if (mark.kind === 'svg') {
    const colors = svgColors(mark.markup);
    return colors.background ?? contrastingColor(colors.foreground, random);
  }
  // A dark neutral is the proxy for emoji outlines. Glyphs use this same ink on light backgrounds.
  return contrastingColor('#202020', random);
}

export interface AvatarColorState { icon?: string | null; avatar_bg?: string | null; avatar_bg_manual?: number }
/** Resolve once at write time. An unrelated save never rerolls the color. */
export function resolveAvatarColor(patch: AvatarColorState, current?: AvatarColorState): AvatarColorState {
  const icon = patch.icon === undefined ? current?.icon : patch.icon;
  const manual = patch.avatar_bg_manual ?? (patch.avatar_bg != null ? 1 : current?.avatar_bg_manual ?? 0);
  const iconChanged = icon !== current?.icon;
  if (patch.avatar_bg_manual === 0 || (!manual && iconChanged)) {
    const reset = patch.avatar_bg_manual === 0 && patch.avatar_bg === undefined;
    const regenerate = iconChanged || !!current?.avatar_bg_manual || reset;
    return { ...patch, avatar_bg: patch.avatar_bg ?? (regenerate ? autoAvatarColor(icon) : current?.avatar_bg), avatar_bg_manual: 0 };
  }
  return { ...patch, ...(patch.avatar_bg !== undefined ? { avatar_bg_manual: patch.avatar_bg ? manual : 0 } : {}) };
}
