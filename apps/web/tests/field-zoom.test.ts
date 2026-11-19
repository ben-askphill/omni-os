import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// iOS Safari zooms into a field whose text is under 16px when it takes focus, and stays zoomed. `.field` and its size
// modifiers (apps/web/src/index.css) go to at least 16px under (pointer: coarse) and keep their smaller desktop sizes
// under (pointer: fine). A text size utility on a field beats that rule, since utilities sit in a later layer.
const SRC = join(import.meta.dirname, '../src');
const CSS = readFileSync(join(SRC, 'index.css'), 'utf8');
const MODIFIERS = ['.field-sm', '.field-xs', '.field-mono'];
const MIN_PX = 16;

type Rule = { media: string; selectors: string[]; body: string; at: number };

/** Every style rule in a stylesheet with the @media it sits in ('' for none). Enough for index.css, not a full parser. */
function rules(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length));
  const out: Rule[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '{') {
      const head = src.slice(start, i).split(';').pop()!.trim();
      const close = head.startsWith('@') ? -1 : src.indexOf('}', i);
      if (close >= 0 && !src.slice(i + 1, close).includes('{')) {
        out.push({ media: stack.filter((s) => s.startsWith('@media')).join(' '), selectors: head.split(',').map((s) => s.trim()), body: src.slice(i + 1, close), at: i });
        start = i = close;
        start++;
        continue;
      }
      stack.push(head);
      start = i + 1;
    } else if (src[i] === '}') {
      stack.pop();
      start = i + 1;
    }
  }
  return out;
}

const fontSize = (body: string) => body.match(/(?:^|;)\s*font-size:\s*([^;]+)/)?.[1].trim();
const fieldRules = rules(CSS).filter((r) => r.selectors.some((s) => s === '.field' || MODIFIERS.includes(s)));

/** The px a text size utility's value comes to, from index.css tokens; null for a value it cannot tell. */
function px(value: string): number | null {
  const token = value.match(/^var\((--[\w-]+)\)$/);
  if (token) {
    const def = CSS.match(new RegExp(`${token[1]}:\\s*([\\d.]+)px`));
    return def ? Number(def[1]) : null;
  }
  const n = value.match(/^([\d.]+)(px|rem)$/);
  return n ? Number(n[1]) * (n[2] === 'rem' ? 16 : 1) : null;
}

const NAMED: Record<string, number> = { xs: 12, sm: 14, base: 16 };
// A text size utility, its variants, and its value: text-[13px], sm:!text-[length:var(--fs-ui)], text-sm, text-[12px]!.
const SIZE_CLASS = /(?<![\w\-[])((?:[\w\-[\]&*=.()]+:)*)!?text-(?:\[(?:length:)?([^\]]+)\]|(xs|sm|base|lg|xl|\dxl))!?(?![\w-])/g;
// A field's class list: it holds the field class or one of its modifiers.
const FIELD_CLASS = /(?<![\w-])field(?:-sm|-xs|-mono)?(?![\w-])/;
// The class strings in a file: string and template literals (a template keeps its ${} branches), and the className a
// FolderInput passes on to its field.
const STRINGS = /`[^`]*`|"[^"\n]*"|'[^'\n]*'/g;
const FOLDER_INPUT = /<FolderInput\b(?:[^/]|\/(?!>))*?className=(\{`[^`]*`\}|"[^"]*")/g;

function sizesUnder16(classes: string): string[] {
  return [...classes.matchAll(SIZE_CLASS)]
    .filter((m) => !m[1].includes('placeholder:'))
    .filter((m) => {
      const size = m[3] ? (NAMED[m[3]] ?? MIN_PX) : px(m[2]);
      return size !== null && size < MIN_PX;
    })
    .map((m) => m[0]);
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
}

function offences(path: string): string[] {
  const src = readFileSync(path, 'utf8');
  const where = (i: number) => `${relative(SRC, path)}:${src.slice(0, i).split('\n').length}`;
  const out: string[] = [];
  for (const m of src.matchAll(STRINGS)) {
    if (FIELD_CLASS.test(m[0])) out.push(...sizesUnder16(m[0]).map((c) => `${where(m.index)} ${c}`));
  }
  for (const m of src.matchAll(FOLDER_INPUT)) out.push(...sizesUnder16(m[1]).map((c) => `${where(m.index)} ${c}`));
  return out;
}

describe('fields stay at 16px or more on a touch screen', () => {
  it('sizes .field and every modifier at max(1rem, 1em) under (pointer: coarse)', () => {
    const coarse = fieldRules.filter((r) => r.media === '@media (pointer: coarse)');
    const covered = coarse.filter((r) => fontSize(r.body) === 'max(1rem, 1em)').flatMap((r) => r.selectors);
    expect(covered).toEqual(expect.arrayContaining(['.field', ...MODIFIERS]));
  });

  it('keeps every smaller size on a fine pointer, and the 14px base before the coarse rule', () => {
    const sized = fieldRules.filter((r) => fontSize(r.body) && r.media !== '@media (pointer: coarse)');
    const loose = sized.filter((r) => r.media !== '@media (pointer: fine)' && !(r.selectors.length === 1 && r.selectors[0] === '.field'));
    expect(loose.map((r) => r.selectors.join(', '))).toEqual([]);
    // .field's own size and its coarse override have the same specificity in the same layer, so order decides.
    const base = sized.find((r) => r.selectors.length === 1 && r.selectors[0] === '.field' && r.media === '');
    const coarse = fieldRules.find((r) => r.media === '@media (pointer: coarse)' && r.selectors.includes('.field'));
    expect(base && coarse && base.at < coarse.at).toBe(true);
    expect(fontSize(base!.body)).toBe('var(--fs-body)');
  });

  it('finds no field sized by a text utility under 16px', () => {
    expect(files(SRC).flatMap(offences)).toEqual([]);
  });

  it('catches the forms it guards against', () => {
    expect(sizesUnder16('field font-mono !text-[13px]')).toEqual(['!text-[13px]']);
    expect(sizesUnder16('field h-8 w-full !text-[length:var(--fs-input)] sm:!text-[12.5px]')).toEqual(['sm:!text-[12.5px]']);
    expect(sizesUnder16('field text-sm text-[length:var(--fs-ui)]')).toEqual(['text-sm', 'text-[length:var(--fs-ui)]']);
    expect(sizesUnder16('field w-24 !text-[18px] placeholder:!text-[13px] text-center text-fg text-[color:var(--fg-3)]')).toEqual([]);
    expect(FIELD_CLASS.test('`field h-10 w-full${mono ? " font-mono" : ""}`')).toBe(true);
    expect(FIELD_CLASS.test('field-sizing-content')).toBe(false);
    const folder = '<FolderInput dialogTitle="x" onPick={(p) => save(p)} className="min-w-0 !text-[12.5px]" value={v} />';
    expect([...folder.matchAll(FOLDER_INPUT)].flatMap((m) => sizesUnder16(m[1]))).toEqual(['!text-[12.5px]']);
  });
});
