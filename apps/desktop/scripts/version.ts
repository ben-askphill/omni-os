// Sets the desktop app's version for a release: apps/desktop/package.json and its entry in package-lock.json. The
// release workflow runs it on plain Node, before any npm install, and prints the new version.
//
//   node apps/desktop/scripts/version.ts patch|minor|major|<x.y.z>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** The version a release bump makes from `current`: `patch`, `minor`, `major`, or an exact x.y.z no lower than it. */
export function nextVersion(current: string, bump: string): string | { error: string } {
  const now = VERSION.exec(current);
  if (!now) return { error: `the current version ${current} is not x.y.z` };
  const [major, minor, patch] = now.slice(1).map(Number);
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'major') return `${major + 1}.0.0`;
  const exact = VERSION.exec(bump);
  if (!exact) return { error: `${bump} is not patch, minor, major or x.y.z` };
  const parts = exact.slice(1).map(Number);
  const order = parts[0] - major || parts[1] - minor || parts[2] - patch;
  if (order < 0) return { error: `${bump} is lower than the current ${current}` };
  return bump;
}

function main(bump: string | undefined): void {
  const repo = resolve(import.meta.dirname, '../../..');
  const pkgPath = join(repo, 'apps/desktop/package.json');
  const lockPath = join(repo, 'package-lock.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  const next = nextVersion(pkg.version, bump ?? '');
  if (typeof next !== 'string') {
    console.error(`version: ${next.error}`);
    process.exit(2);
  }
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { packages: Record<string, { version?: string }> };
  pkg.version = next;
  lock.packages['apps/desktop'].version = next;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(next);
}

if (import.meta.main) main(process.argv[2]);
