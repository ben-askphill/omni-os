import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// fg-4 is 2.75:1 on white (apps/web/src/index.css): placeholders, disabled labels and decoration, never text that must
// be read. Readable text takes fg-3; a greyed-out label takes text-fg-disabled.
const SRC = join(import.meta.dirname, '../src');

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
