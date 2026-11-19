import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The type tokens in apps/web/src/index.css are rem, so text follows the browser's font size setting, and they come
// to the Claude Design scale's px at the default 16px root. The text-[Npx] utilities are still px (W18 stage 1).
const CSS = readFileSync(join(import.meta.dirname, '../src/index.css'), 'utf8');
// The token table: the first `:root, .scheme-dark` rule.
const ROOT = CSS.slice(CSS.indexOf(':root,'), CSS.indexOf('}', CSS.indexOf(':root,')));

// The scale in px, as tokens/type.css and apps/ios/src/theme.ts have it.
const SCALE: Record<string, number> = {
  label: 10.5,
  meta: 11,
  code: 11.5,
  '12': 12,
  small: 12.5,
  ui: 13,
  nav: 13.5,
  body: 14,
  prose: 14.5,
  subhead: 15,
  input: 16,
  heading: 17,
  title: 26,
  'title-lg': 30,
  display: 44,
};

const tokens = () => [...ROOT.matchAll(/--fs-([\w-]+):\s*([^;]+);/g)].map((m) => ({ name: m[1], value: m[2].trim() }));

describe('type tokens are rem', () => {
  it('defines every --fs-* in rem, at the same size as before at a 16px root', () => {
    const defs = tokens();
    expect(defs.map((d) => d.name).sort()).toEqual(Object.keys(SCALE).sort());
    for (const { name, value } of defs) {
      const rem = value.match(/^([\d.]+)rem$/);
      expect(rem, `--fs-${name}: ${value}`).not.toBeNull();
      expect(Number(rem![1]) * 16, `--fs-${name}`).toBe(SCALE[name]);
    }
  });

  it('sizes body and the caption font from the tokens', () => {
    expect(CSS).toMatch(/\n  body \{[^}]*font-size: var\(--fs-body\);/);
    expect(ROOT).toMatch(/--type-caption: var\(--fw-medium\) var\(--fs-12\)\/1\.2 var\(--font-sans\);/);
  });

  it('never sets a root font size, which would cancel the browser setting', () => {
    expect(CSS).not.toMatch(/(?:^|\n)\s*(?:html|:root)\s*(?:,[^{]*)?\{[^}]*font-size/);
  });
});
