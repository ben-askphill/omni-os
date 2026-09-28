import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Web UI (web/) and the Mac app (mac/) are two clients of one server and never share code
// directly. What both need lives in shared/, which imports only itself. Fails on any import
// that crosses those lines.

const root = resolve(import.meta.dirname, '..');
const SKIP = new Set(['node_modules', '.build', '.swiftpm', '.xcode', 'Resources']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [p] : [];
  });
}

/** Each relative import in a file, as a path from the repo root. */
function imports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const specs = [...src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]);
  return specs.map((s) => relative(root, resolve(dirname(file), s)).split(sep).join('/'));
}

/** Imports from `dir` whose target is outside every folder in `allowed`. */
function crossings(dir: string, allowed: string[]): string[] {
  return files(join(root, dir)).flatMap((f) =>
    imports(f)
      .filter((to) => !allowed.some((a) => to === a || to.startsWith(`${a}/`)))
      .map((to) => `${relative(root, f)} imports ${to}`),
  );
}

describe('app boundaries', () => {
  it('the Web UI imports nothing from the Mac app', () => {
    expect(crossings('web', ['web', 'shared', 'server'])).toEqual([]);
  });

  it('the Mac app imports nothing from the Web UI', () => {
    expect(crossings('mac', ['mac', 'shared'])).toEqual([]);
  });

  it('shared code imports only shared code', () => {
    expect(crossings('shared', ['shared'])).toEqual([]);
  });
});
