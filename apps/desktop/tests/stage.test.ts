import { describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { builderArgs } from '../scripts/dist.ts';
import {
  compareVersions,
  copyProblem,
  dependencyClosure,
  elfVersionNeeds,
  EXTERNALS,
  fieldAllows,
  glibcProblems,
  keepPtyFile,
  parseStageArgs,
  resolveFrom,
  stagedPtyProblems,
  type Lockfile,
  type Target,
} from '../scripts/stage.ts';

const linux: Target = { platform: 'linux', arches: ['x64'] };
const macArm: Target = { platform: 'darwin', arches: ['arm64'] };
const universal: Target = { platform: 'darwin', arches: ['arm64', 'x64'] };
const realLock = () => JSON.parse(readFileSync(join(import.meta.dirname, '../../../package-lock.json'), 'utf8')) as Lockfile;

// A small lock in npm's v3 shape: a workspace, hoisted and nested copies, a platform binary per OS, a peer.
const lock: Lockfile = {
  packages: {
    '': { dependencies: {} },
    'apps/server': { dependencies: { tool: '^1', pty: '^1' } },
    'node_modules/@omni/server': { link: true, resolved: 'apps/server' },
    'node_modules/tool': { version: '1.0.0', dependencies: { lib: '^2', engine: '^1' }, optionalDependencies: { watcher: '^1' } },
    'node_modules/tool/node_modules/lib': { version: '2.0.0', dependencies: { util: '^1' } },
    'node_modules/lib': { version: '1.0.0' },
    'node_modules/util': { version: '1.0.0' },
    'node_modules/engine': {
      version: '1.0.0',
      optionalDependencies: { '@engine/linux-x64': '1.0.0', '@engine/darwin-arm64': '1.0.0', '@engine/darwin-x64': '1.0.0' },
      peerDependencies: { host: '*', missing: '*' },
      peerDependenciesMeta: { missing: { optional: true } },
    },
    'node_modules/@engine/linux-x64': { version: '1.0.0', os: ['linux'], cpu: ['x64'], optional: true } as Lockfile['packages'][string],
    'node_modules/@engine/darwin-arm64': { version: '1.0.0', os: ['darwin'], cpu: ['arm64'] },
    'node_modules/@engine/darwin-x64': { version: '1.0.0', os: ['darwin'], cpu: ['x64'] },
    'node_modules/watcher': { version: '1.0.0', os: ['darwin'] },
    'node_modules/host': { version: '3.0.0' },
    'node_modules/pty': { version: '1.0.0', dependencies: { 'addon-api': '^7' } },
    'node_modules/addon-api': { version: '7.0.0' },
    'node_modules/unrelated': { version: '1.0.0' },
  },
};

describe('the closure walk over package-lock.json', () => {
  it('resolves a name the way Node does, nearest node_modules first', () => {
    expect(resolveFrom(lock.packages, 'node_modules/tool', 'lib')).toBe('node_modules/tool/node_modules/lib');
    expect(resolveFrom(lock.packages, 'node_modules/tool/node_modules/lib', 'util')).toBe('node_modules/util');
    expect(resolveFrom(lock.packages, 'apps/server', 'tool')).toBe('node_modules/tool');
    expect(resolveFrom(lock.packages, 'node_modules/tool', 'nothing')).toBeNull();
  });

  it('takes the run-time dependencies for Linux, and only its own platform binary', () => {
    expect(dependencyClosure(lock, ['tool', 'pty'], linux, 'apps/server')).toEqual([
      'node_modules/@engine/linux-x64',
      'node_modules/addon-api',
      'node_modules/engine',
      'node_modules/host',
      'node_modules/pty',
      'node_modules/tool',
      'node_modules/tool/node_modules/lib',
      'node_modules/util',
    ]);
  });

  it('takes both arches for a universal Mac build, and Mac-only optionals', () => {
    const paths = dependencyClosure(lock, ['tool'], universal, 'apps/server');
    expect(paths).toContain('node_modules/@engine/darwin-arm64');
    expect(paths).toContain('node_modules/@engine/darwin-x64');
    expect(paths).toContain('node_modules/watcher');
    expect(paths).not.toContain('node_modules/@engine/linux-x64');
    expect(paths).not.toContain('node_modules/lib');
    expect(dependencyClosure(lock, ['tool'], macArm, 'apps/server')).not.toContain('node_modules/@engine/darwin-x64');
  });

  it('fails on a required dependency the lock does not have', () => {
    const broken: Lockfile = { packages: { ...lock.packages, 'node_modules/pty': { version: '1.0.0', dependencies: { gone: '^1' } } } };
    expect(() => dependencyClosure(broken, ['pty'], linux, 'apps/server')).toThrow(/missing gone \(for node_modules\/pty\)/);
    expect(() => dependencyClosure(lock, ['nope'], linux, 'apps/server')).toThrow(/no nope/);
  });

  it('reads npm os and cpu lists, exclusions included', () => {
    expect(fieldAllows(undefined, ['linux'])).toBe(true);
    expect(fieldAllows(['darwin', 'linux'], ['linux'])).toBe(true);
    expect(fieldAllows(['!win32'], ['linux'])).toBe(true);
    expect(fieldAllows(['!linux'], ['linux'])).toBe(false);
    expect(fieldAllows(['arm64'], ['arm64', 'x64'])).toBe(true);
  });

  it('walks the real lock for the bundle externals', () => {
    const paths = dependencyClosure(realLock(), EXTERNALS, universal, 'apps/server');
    expect(paths).toEqual(expect.arrayContaining(['node_modules/node-pty', 'node_modules/@playwright/mcp']));
    expect(paths.some((p) => p.includes('linux'))).toBe(false);
  });

  it('can ship every package of the real closure to any target from any machine', () => {
    const real = realLock();
    for (const target of [linux, { platform: 'linux', arches: ['arm64'] } as Target, macArm, universal]) {
      const paths = dependencyClosure(real, EXTERNALS, target, 'apps/server').filter((p) => !p.endsWith('node_modules/node-pty'));
      const problems = paths.map((p) => copyProblem(p, real.packages[p], real.packages[p].version ?? null, false)).filter(Boolean);
      expect(problems, `${target.platform}-${target.arches.join('+')}`).toEqual([]);
    }
  });
});

describe('stage.ts and the server bundle', () => {
  it('ships exactly the packages bundle.ts leaves external', () => {
    const bundle = readFileSync(join(import.meta.dirname, '../../server/scripts/bundle.ts'), 'utf8');
    const listed = bundle.match(/export const EXTERNAL = \[([^\]]*)\]/)?.[1] ?? '';
    expect([...listed.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...EXTERNALS]);
  });
});

describe("node-pty's files", () => {
  it('ships the compiled addon on Linux and no prebuilds', () => {
    expect(keepPtyFile('build/Release/pty.node', linux)).toBe(true);
    expect(keepPtyFile('build/Release/obj.target/pty.o', linux)).toBe(false);
    expect(keepPtyFile('build/Makefile', linux)).toBe(false);
    expect(keepPtyFile('prebuilds/darwin-arm64/pty.node', linux)).toBe(false);
    expect(keepPtyFile('lib/index.js', linux)).toBe(true);
  });

  it('ships only the target arches prebuilds on a Mac, and never build/, which the loader would try first', () => {
    expect(keepPtyFile('build/Release/pty.node', macArm)).toBe(false);
    expect(keepPtyFile('prebuilds/darwin-arm64/pty.node', macArm)).toBe(true);
    expect(keepPtyFile('prebuilds/darwin-x64/spawn-helper', macArm)).toBe(false);
    expect(keepPtyFile('prebuilds/darwin-x64/spawn-helper', universal)).toBe(true);
    expect(keepPtyFile('prebuilds/win32-x64/pty.node', universal)).toBe(false);
    expect(keepPtyFile('deps/winpty/src/main.cc', universal)).toBe(false);
  });
});

// The version names of an ELF's .dynstr, as a linker writes them: NUL-separated among the symbol names.
const elf = (...names: string[]) => Buffer.from(`\x7fELF\0forkpty\0${names.join('\0')}\0`, 'latin1');

describe('the glibc floor for the Linux addon', () => {
  it('compares dotted versions as numbers', () => {
    expect(compareVersions('2.42', '2.28')).toBeGreaterThan(0);
    expect(compareVersions('2.4', '2.28')).toBeLessThan(0);
    expect(compareVersions('3.4.25', '3.4.25')).toBe(0);
    expect(compareVersions('3.4', '3.4.1')).toBeLessThan(0);
  });

  it('finds the newest glibc and libstdc++ versions an addon needs', () => {
    expect(elfVersionNeeds(elf('GLIBC_2.2.5', 'GLIBC_2.42', 'GLIBC_2.34', 'GLIBCXX_3.4.21', 'GLIBCXX_3.4', 'CXXABI_1.3.9', 'GLIBC_PRIVATE'))).toEqual({
      glibc: '2.42',
      glibcxx: '3.4.21',
    });
    expect(elfVersionNeeds(elf())).toEqual({ glibc: null, glibcxx: null });
  });

  it('flags an addon built on a current distro and passes one built on an old one', () => {
    expect(glibcProblems(elf('GLIBC_2.2.5', 'GLIBC_2.34', 'GLIBC_2.42', 'GLIBCXX_3.4.22'))).toEqual(['glibc 2.42 (the floor is 2.28)']);
    expect(glibcProblems(elf('GLIBC_2.28', 'GLIBCXX_3.4.30'))).toEqual(['libstdc++ 3.4.30 (the floor is 3.4.25)']);
    expect(glibcProblems(elf('GLIBC_2.2.5', 'GLIBC_2.28', 'GLIBCXX_3.4.21'))).toEqual([]);
  });
});

describe('the staged node-pty', () => {
  const tree = (files: Record<string, { bytes?: Buffer; mode?: number }>) => {
    const dir = mkdtempSync(join(tmpdir(), 'omni-stage-pty-'));
    for (const [rel, file] of Object.entries(files)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), file.bytes ?? Buffer.from('x'));
      chmodSync(join(dir, rel), file.mode ?? 0o644);
    }
    return dir;
  };

  it('needs an executable spawn-helper for each Mac arch', () => {
    const dir = tree({ 'prebuilds/darwin-arm64/spawn-helper': { mode: 0o755 }, 'prebuilds/darwin-x64/spawn-helper': { mode: 0o644 } });
    try {
      expect(stagedPtyProblems(dir, macArm)).toEqual([]);
      expect(stagedPtyProblems(dir, universal)).toEqual(['prebuilds/darwin-x64/spawn-helper is not executable']);
      expect(stagedPtyProblems(dir, { platform: 'darwin', arches: ['x64', 'arm64'] })).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('needs a Linux addon within the glibc floor, unless the build asked for this machine', () => {
    const dir = tree({ 'build/Release/pty.node': { bytes: elf('GLIBC_2.34', 'GLIBC_2.42') } });
    try {
      expect(stagedPtyProblems(dir, linux)).toEqual(['build/Release/pty.node needs glibc 2.42 (the floor is 2.28)']);
      expect(stagedPtyProblems(dir, linux, true)).toEqual([]);
      expect(stagedPtyProblems(join(dir, 'nothing'), linux)).toEqual(['build/Release/pty.node is missing']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("copying a package from the repo's node_modules", () => {
  const plain = { version: '1.0.0' };
  const native = { version: '1.0.0', hasInstallScript: true };

  it('ships an installed package at its locked version', () => {
    expect(copyProblem('node_modules/lib', plain, '1.0.0', false)).toBeNull();
    expect(copyProblem('node_modules/engine', native, '1.0.0', true)).toBeNull();
  });

  it('refuses a missing or drifted install', () => {
    expect(copyProblem('node_modules/lib', plain, null, true)).toMatch(/not installed, not the locked 1.0.0/);
    expect(copyProblem('node_modules/lib', plain, '1.1.0', true)).toMatch(/is 1.1.0, not the locked 1.0.0/);
  });

  it("refuses a package with an install script for a target that is not this machine", () => {
    expect(copyProblem('node_modules/engine', native, '1.0.0', false)).toMatch(/install script/);
  });
});

describe('the command lines', () => {
  it('parses a target, defaulting to this machine', () => {
    expect(parseStageArgs([], { platform: 'linux', arch: 'x64' })).toEqual({ target: linux, skipWeb: false, hostGlibc: false });
    expect(parseStageArgs(['--platform', 'mac', '--arch', 'universal', '--skip-web'], { platform: 'linux', arch: 'x64' })).toEqual({
      target: universal,
      skipWeb: true,
      hostGlibc: false,
    });
    expect(parseStageArgs(['--host-glibc'], { platform: 'linux', arch: 'x64' })).toMatchObject({ hostGlibc: true });
    expect(parseStageArgs(['--platform', 'linux', '--arch', 'universal'], { platform: 'linux', arch: 'x64' })).toEqual({ error: 'universal is a Mac build' });
    expect(parseStageArgs(['--platform', 'win'], { platform: 'linux', arch: 'x64' })).toHaveProperty('error');
  });

  it('hands electron-builder the same arch, and publishes only when asked', () => {
    const args = builderArgs({ platform: 'darwin', arch: 'universal', dir: true });
    expect(args).toEqual(expect.arrayContaining(['--mac', '--universal', '--dir']));
    expect(args.slice(-2)).toEqual(['--publish', 'never']);
    expect(builderArgs({ platform: 'linux', arch: 'x64', dir: false })).not.toContain('--dir');
    expect(builderArgs({ platform: 'linux', arch: 'x64', dir: false, publish: true }).slice(-2)).toEqual(['--publish', 'always']);
  });
});
