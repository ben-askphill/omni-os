import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// The contrast the tokens in apps/web/src/index.css promise, and the rules that lean on them.
// fg-4 is 2.75:1 on white: placeholders, disabled labels and decoration, never text that must be read. Readable text
// takes fg-3; a greyed-out label takes text-fg-disabled.
const SRC = join(import.meta.dirname, '../src');
const CSS = readFileSync(join(SRC, 'index.css'), 'utf8');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(tsx?|css)$/.test(e.name) ? [join(dir, e.name)] : []));
}

// A text-fg-4 class and the variants in front of it. placeholder: and disabled: are the uses fg-4 is for.
const TEXT_CLASS = /(?<![\w\-[])((?:[\w\-[\]*&=.'"]+:)*)text-fg-4(?![\w-])/g;
const ALLOWED_VARIANTS = ['placeholder:', 'disabled:'];

function offences(path: string): string[] {
  const src = readFileSync(path, 'utf8');
  const where = (i: number) => `${relative(SRC, path)}:${src.slice(0, i).split('\n').length}`;
  const out: string[] = [];
  if (path.endsWith('.css')) {
    let selector = '';
    src.split('\n').forEach((line, n) => {
      if (line.trim().endsWith('{')) selector = line.trim();
      if (/^\s*color:\s*var\(--fg-4\)/.test(line) && !selector.includes('placeholder')) out.push(`${relative(SRC, path)}:${n + 1} ${line.trim()}`);
    });
    return out;
  }
  for (const m of src.matchAll(TEXT_CLASS)) {
    if (!ALLOWED_VARIANTS.some((v) => m[1].includes(v))) out.push(`${where(m.index)} ${m[0]}`);
  }
  for (const m of src.matchAll(/color:\s*['"]?var\(--fg-4\)|text-\[color:var\(--fg-4\)\]/g)) out.push(`${where(m.index)} ${m[0]}`);
  return out;
}

describe('fg-4 never colours readable text', () => {
  it('finds no text use of fg-4 outside placeholders and disabled labels', () => {
    expect(files(SRC).flatMap(offences)).toEqual([]);
  });

  it('catches the forms it guards against', () => {
    const probe = (src: string) => [...src.matchAll(TEXT_CLASS)].filter((m) => !ALLOWED_VARIANTS.some((v) => m[1].includes(v))).length;
    expect(probe('className="text-[12px] text-fg-4"')).toBe(1);
    expect(probe('className="hover:text-fg-4 text-fg-4/70"')).toBe(2);
    expect(probe('className="placeholder:text-fg-4 disabled:text-fg-4 bg-fg-4 border-fg-4 text-fg-disabled"')).toBe(0);
  });
});

type Rgb = [number, number, number];
type Scheme = 'light' | 'dark';

/** A token's value per scheme, from the first `--name:` in index.css (the :root table). Follows var() and light-dark(). */
function token(name: string, scheme: Scheme, css = CSS): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`no --${name} in index.css`);
  return resolve(m[1].trim(), scheme, css);
}

function resolve(value: string, scheme: Scheme, css = CSS): string {
  const ld = /^light-dark\((.+)\)$/.exec(value);
  if (ld) {
    let depth = 0;
    const comma = [...ld[1]].findIndex((c) => ((depth += c === '(' ? 1 : c === ')' ? -1 : 0), c === ',' && depth === 0));
    return resolve((scheme === 'light' ? ld[1].slice(0, comma) : ld[1].slice(comma + 1)).trim(), scheme, css);
  }
  const v = /^var\(--([\w-]+)\)$/.exec(value);
  return v ? token(v[1], scheme, css) : value;
}

/** #rrggbb or rgb(r g b / a), composited over `under`. */
function rgb(color: string, under: Rgb = [255, 255, 255]): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as Rgb;
  const fn = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(color);
  if (!fn) throw new Error(`can't read colour ${color}`);
  const a = fn[4] ? Number(fn[4]) : 1;
  return [1, 2, 3].map((i, k) => Number(fn[i]) * a + under[k] * (1 - a)) as Rgb;
}

const luminance = (c: Rgb) =>
  c.map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);

/** WCAG contrast of `fg` over `bg`, both token values. */
function contrast(fg: string, bg: string, scheme: Scheme, css = CSS): number {
  const back = rgb(resolve(bg, scheme, css));
  const [a, b] = [luminance(rgb(resolve(fg, scheme, css), back)), luminance(back)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Every surface a control or scroller sits on, the pane's and the cards' inside it.
const SURFACES = ['var(--bg)', 'var(--canvas)', 'var(--surface)', 'var(--surface-2)', 'var(--surface-3)'];
const SCHEMES: Scheme[] = ['light', 'dark'];

/** The body of the first rule whose selector list includes `selector` (inside @media blocks too). */
function rule(selector: string, css = CSS): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[,}\\s])${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'm').exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

const MORE = (() => {
  const at = CSS.indexOf('@media (prefers-contrast: more)');
  if (at < 0) throw new Error('no prefers-contrast: more block');
  return CSS.slice(at, CSS.indexOf('\n}\n', at));
})();
/** index.css as Increase contrast sees it: the prefers-contrast block's tokens win. */
const MORE_CSS = MORE + CSS;

describe('non-text contrast reaches 3:1 (WCAG 1.4.11)', () => {
  for (const scheme of SCHEMES) {
    it(`line-control, the scrollbar thumb and the Toggle's off edge, in ${scheme}`, () => {
      for (const bg of SURFACES) expect(contrast('var(--line-control)', bg, scheme), bg).toBeGreaterThanOrEqual(3);
    });

    it(`the focus ring (fg), in ${scheme}`, () => {
      for (const bg of SURFACES) expect(contrast('var(--fg)', bg, scheme), bg).toBeGreaterThanOrEqual(3);
    });

    it(`Increase contrast: line-strong and line-control, in ${scheme}`, () => {
      for (const bg of ['var(--bg)', 'var(--surface)', 'var(--surface-2)']) {
        expect(contrast('var(--line-strong)', bg, scheme, MORE_CSS), bg).toBeGreaterThanOrEqual(3);
        expect(contrast('var(--line-control)', bg, scheme, MORE_CSS), bg).toBeGreaterThanOrEqual(contrast('var(--line-control)', bg, scheme));
        expect(contrast('var(--line)', bg, scheme, MORE_CSS), bg).toBeGreaterThan(contrast('var(--line)', bg, scheme));
      }
    });
  }

  it('the rules use those tokens', () => {
    expect(rule('.scroll-thin')).toMatch(/scrollbar-color:\s*var\(--line-control\)/);
    expect(rule('.tgl')).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--line-control\)/);
    // The ring is an outline, not a box-shadow: forced colors drops shadows and keeps outlines.
    for (const s of ['.field:focus-visible', '.focus-ring:focus-visible', '.focus-ring-within:has(:focus-visible)']) {
      expect(rule(s), s).toMatch(/outline:\s*2px solid var\(--fg\)/);
    }
    expect(MORE).toMatch(/--line-control:/);
    expect(MORE).toMatch(/--line-strong:/);
  });

  it('draws the Toggle in system colours under forced colors', () => {
    const forced = CSS.slice(CSS.indexOf('@media (forced-colors: active) {\n    .tgl {'));
    expect(forced).toMatch(/forced-color-adjust:\s*none/);
    expect(forced).toMatch(/border:\s*1px solid CanvasText/);
    expect(forced).toMatch(/\.tgl\[aria-checked="true"\] \{\s*background:\s*Highlight/);
  });

  it('reads the token table the way the browser does', () => {
    expect(contrast('var(--fg-4)', 'var(--bg)', 'light')).toBeCloseTo(2.75, 2);
    expect(contrast('var(--line-strong)', 'var(--bg)', 'light')).toBeCloseTo(1.4, 1);
  });
});
