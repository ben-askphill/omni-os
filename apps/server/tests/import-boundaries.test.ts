// The runtime import graph of apps/server never has a cycle that crosses an ownership boundary. Before #410 one
// component of 20 files spanned runner/, run-on.ts, handoff.ts, automations and published.ts; the runner now reaches
// those through runner/ports.ts, bound in compose.ts, so a cycle may exist only inside one owner (a directory such
// as runner/, or a single top-level file). Type-only imports are not edges: they never load a module.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const SKIP = new Set(['node_modules', 'tests', 'scripts', 'dist']);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const IMPORT = /^\s*(?:import|export)\s+(?!type\b)[^'"]*?\sfrom\s+['"](\.[^'"]+)['"]|^\s*import\s+['"](\.[^'"]+)['"]/gm;

/** A clause whose every specifier is `type X` loads nothing either. */
function typesOnly(clause: string): boolean {
  const braces = clause.match(/\{([^}]*)\}/);
  if (!braces || /^\s*import\s+['"]/.test(clause) || /import\s+\*/.test(clause) || /^\s*import\s+[\w$]+\s*(,|\s+from)/.test(clause)) return false;
  const names = braces[1].split(',').map((s) => s.trim()).filter(Boolean);
  return names.length > 0 && names.every((n) => /^type\s/.test(n));
}

/** Runtime relative imports, file to the files it loads. */
export function importGraph(root = ROOT): Map<string, Set<string>> {
  const files = new Set(sources(root));
  const edges = new Map<string, Set<string>>();
  for (const f of files) {
    const out = new Set<string>();
    for (const m of readFileSync(f, 'utf8').matchAll(IMPORT)) {
      if (typesOnly(m[0])) continue;
      const target = resolve(dirname(f), m[1] ?? m[2]);
      if (files.has(target)) out.add(target);
    }
    edges.set(f, out);
  }
  return edges;
}

/** Tarjan's strongly connected components, in the graph's own order. */
export function components(edges: Map<string, Set<string>>): string[][] {
  let n = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const out: string[][] = [];
  const visit = (v: string) => {
    index.set(v, n);
    low.set(v, n);
    n++;
    stack.push(v);
    on.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const c: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        on.delete(w);
        c.push(w);
      } while (w !== v);
      out.push(c);
    }
  };
  for (const v of edges.keys()) if (!index.has(v)) visit(v);
  return out;
}

/** Who owns a file: its directory under apps/server, or the file itself at the top level. */
const ownerOf = (file: string) => {
  const rel = relative(ROOT, file);
  return rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : rel;
};

describe('import boundaries', () => {
  const edges = importGraph();
  const cycles = components(edges).filter((c) => c.length > 1);

  it('no runtime import cycle crosses an ownership boundary', () => {
    const crossing = cycles.filter((c) => new Set(c.map(ownerOf)).size > 1);
    const describe = (c: string[]) => c.map((f) => relative(ROOT, f)).sort().join(', ');
    expect(crossing.map(describe)).toEqual([]);
  });

  it("the runner's files import none of the modules its ports stand for", () => {
    const runner = [...edges.keys()].filter((f) => ownerOf(f) === 'runner');
    const forbidden = ['run-on.ts', 'handoff.ts', 'published.ts', 'automations.ts', 'automation-triggers.ts', 'compose.ts'].map((n) => resolve(ROOT, n));
    const bad = runner.flatMap((f) => [...edges.get(f)!].filter((t) => forbidden.includes(t)).map((t) => `${relative(ROOT, f)} -> ${relative(ROOT, t)}`));
    expect(bad).toEqual([]);
  });

  it('the one remaining cycle is inside the runner and no larger than it was', () => {
    // The lifecycle modules call each other (queue starts a turn, records ends it, session closes it). That cycle
    // stays within runner/ and shrinks or holds; a file added to it needs a reason here.
    const inRunner = cycles.filter((c) => c.every((f) => ownerOf(f) === 'runner'));
    expect(inRunner.length).toBeLessThanOrEqual(1);
    expect(inRunner[0]?.length ?? 0).toBeLessThanOrEqual(9);
  });
});
