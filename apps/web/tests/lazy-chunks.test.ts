import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The pages lazy.tsx loads on demand stay out of the main bundle only while nothing the entry imports statically
// imports them. One such import builds and runs fine, and quietly puts them back in front of the first paint (M26).

const SRC = join(import.meta.dirname, '../src');
const ON_DEMAND = ['pages/Settings.tsx', 'pages/Automations.tsx', 'pages/ChannelSettings.tsx', 'components/Onboarding.tsx'];

/** The relative modules `file` imports at load time: no `import type`, no all-type braces, no `import()`. */
function staticImports(file: string): string[] {
  const code = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const [, clause, spec] of code.matchAll(/^\s*(?:import|export)\s+([^'";]*?)\s*(?:from\s+)?['"](\.[^'"]+)['"]/gm)) {
    if (/^type\s/.test(clause)) continue;
    const names = clause.match(/^\{([^}]*)\}$/)?.[1];
    if (names !== undefined && names.split(',').every((n) => !n.trim() || /^type\s/.test(n.trim()))) continue;
    const target = resolve(dirname(file), spec);
    if (existsSync(target)) out.push(target);
  }
  return out;
}

function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const todo = [entry];
  while (todo.length) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    todo.push(...staticImports(file));
  }
  return seen;
}

describe('the main bundle', () => {
  const main = reachableFrom(join(SRC, 'main.tsx'));

  it('reaches the app, so the walk follows imports at all', () => {
    expect(main.has(join(SRC, 'App.tsx'))).toBe(true);
    expect(main.has(join(SRC, 'lazy.tsx'))).toBe(true);
  });

  for (const page of ON_DEMAND)
    it(`leaves ${page} to its own chunk`, () => {
      expect(main.has(join(SRC, page))).toBe(false);
    });
});
