import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, resolve } from 'node:path';
import { EXTERNAL } from '../scripts/bundle.ts';

// esbuild bundles what is imported, but not a package loaded at run time through createRequire: that call stays
// in the bundle as it is, and the packaged app has only EXTERNAL's packages on disk. The terminal once failed with
// "Cannot find module '@xterm/headless'" that way.

const REPO = resolve(import.meta.dirname, '../../..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((f) => f.isFile() && f.name.endsWith('.ts') && !f.name.endsWith('.d.ts'))
    .map((f) => join(f.parentPath, f.name))
    .filter((f) => !/\/(tests|scripts|node_modules)\//.test(f));
}

function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

describe('packages loaded at run time', () => {
  it('are all left external, so the desktop app ships them', () => {
    const found = new Map<string, string>();
    for (const file of [...sources(join(REPO, 'apps/server')), ...sources(join(REPO, 'apps/mcp'))]) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\brequire(?:\.resolve)?\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const name = packageOf(m[1]);
        if (m[1].startsWith('.') || m[1].startsWith('node:') || builtinModules.includes(name)) continue;
        found.set(name, file.slice(REPO.length + 1));
      }
    }
    expect(found.size).toBeGreaterThan(0);
    const missing = [...found].filter(([name]) => !(EXTERNAL as readonly string[]).includes(name));
    expect(missing).toEqual([]);
  });
});
