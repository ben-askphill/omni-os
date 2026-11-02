import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The iOS app (React Native) imports the fold. Metro has no DOM and no Node, so the fold and everything it reaches
// must import only sibling modules and use no browser or Node global.

const ENTRIES = ['transcript-fold.ts', 'thread-view.ts', 'cloud-agent.ts', 'short-path.ts'];
const GLOBALS = /\b(document|window|localStorage|sessionStorage|navigator|process|Buffer|require)\b\s*[.(\[]/;

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');

function closure(entries: string[]) {
  const seen = new Map<string, string>();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const src = strip(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    seen.set(file, src);
    for (const m of src.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) if (m[1].startsWith('./')) queue.push(m[1].slice(2));
  }
  return seen;
}

describe('the transcript fold is portable', () => {
  const files = closure(ENTRIES);

  it('reaches the modules it needs', () => {
    expect([...files.keys()].sort()).toEqual(expect.arrayContaining(['history.ts', 'question.ts', 'thread-view.ts', 'transcript-fold.ts']));
  });

  it.each([...files.keys()])('%s imports only siblings', (file) => {
    const specs = [...files.get(file)!.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(specs.filter((s) => !s.startsWith('./')), file).toEqual([]);
  });

  it.each([...files.keys()])('%s uses no browser or Node global', (file) => {
    expect(files.get(file)!, file).not.toMatch(GLOBALS);
  });
});
