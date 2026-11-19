import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareVersions, type Lockfile } from '../scripts/stage.ts';

const realLock = () => JSON.parse(readFileSync(join(import.meta.dirname, '../../../package-lock.json'), 'utf8')) as Lockfile;

// The lowest version each package may resolve to anywhere in the lock: the first release past its published
// advisories (dependency audit of 2026-11-18). The desktop app ships the server's closure, so a copy below its
// floor ships too. A pair is [first affected version, floor] for an advisory that leaves older majors alone.
// glob 13.0.7 carries the 14.0.2 abort fix. minimatch and katex have no floor: their fixed releases are majors
// the dependents (glob 13, expo, mermaid 11) do not accept yet.
const FLOORS: Record<string, string | [string, string]> = {
  '@modelcontextprotocol/sdk': '1.32.0',
  hono: '4.13.16',
  '@hono/node-server': '2.1.6',
  zod: '4.6.6',
  'body-parser': '2.4.0',
  qs: '6.16.1',
  'source-map-js': '1.2.2',
  vite: '8.3.3',
  'fast-uri': '3.1.9',
  'ip-address': '10.7.4',
  'node-forge': '1.4.3',
  glob: ['9.0.0', '13.0.7'],
};

describe('dependency floors', () => {
  it('resolves every copy of a floored package at or above its floor', () => {
    const packages = realLock().packages;
    const below: string[] = [];
    for (const [name, rule] of Object.entries(FLOORS)) {
      const [from, floor] = typeof rule === 'string' ? ['0', rule] : rule;
      const copies = Object.entries(packages).filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`));
      expect(copies.length, `${name} is in the lock`).toBeGreaterThan(0);
      for (const [path, meta] of copies) {
        const version = meta.version ?? '0';
        if (compareVersions(version, from) >= 0 && compareVersions(version, floor) < 0) below.push(`${path} ${version} < ${floor}`);
      }
    }
    expect(below).toEqual([]);
  });
});
