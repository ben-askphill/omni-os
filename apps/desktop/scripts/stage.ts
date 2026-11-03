// Writes build/omni: the app root the packaged server runs from, the repo's layout in small.
// The server and MCP bundles, the built Web UI, the shipped defaults, a version-stamped package.json, and a
// node_modules with only the bundle's external packages and their dependencies for one target.
//
//   tsx scripts/stage.ts [--platform mac|linux] [--arch arm64|x64|universal] [--skip-web] [--host-glibc]
//
//   --host-glibc  ship this machine's node-pty build on Linux even when it needs a newer glibc than the floor
//
// Packages come from the repo's node_modules along package-lock.json's graph, at their locked versions.
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';

const DESKTOP = resolve(import.meta.dirname, '..');
const REPO = resolve(DESKTOP, '../..');
export const STAGE_DIR = join(DESKTOP, 'build', 'omni');
const CACHE_DIR = join(DESKTOP, 'build', 'cache');

/** The packages apps/server/scripts/bundle.ts leaves out of the bundle (its EXTERNAL). tests/stage.test.ts keeps the two equal. */
export const EXTERNALS = ['node-pty', '@playwright/mcp'] as const;

/** Copied as they are, beside the bundles. */
const SHIPPED_DIRS = ['crew', 'automations', 'mods', 'prototypes/activity-monitor'] as const;

export type Arch = 'x64' | 'arm64';
export interface Target {
  platform: 'darwin' | 'linux';
  /** Two for a universal Mac build. */
  arches: Arch[];
}

export interface StageArgs {
  target: Target;
  skipWeb: boolean;
  /** Ship a Linux node-pty that only runs on a glibc as new as this machine's. For local test builds. */
  hostGlibc: boolean;
}

export function parseStageArgs(argv: readonly string[], host: { platform: string; arch: string }): StageArgs | { error: string } {
  let platform: string = host.platform === 'darwin' ? 'mac' : host.platform;
  let arch: string = host.arch;
  let skipWeb = false;
  let hostGlibc = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--platform') platform = argv[++i] ?? '';
    else if (arg === '--arch') arch = argv[++i] ?? '';
    else if (arg === '--skip-web') skipWeb = true;
    else if (arg === '--host-glibc') hostGlibc = true;
    else return { error: `unknown option ${arg}` };
  }
  if (platform !== 'mac' && platform !== 'linux') return { error: '--platform needs mac or linux' };
  if (arch !== 'x64' && arch !== 'arm64' && arch !== 'universal') return { error: '--arch needs arm64, x64 or universal' };
  if (arch === 'universal' && platform !== 'mac') return { error: 'universal is a Mac build' };
  const arches: Arch[] = arch === 'universal' ? ['arm64', 'x64'] : [arch];
  return { target: { platform: platform === 'mac' ? 'darwin' : 'linux', arches }, skipWeb, hostGlibc };
}

/** One package in package-lock.json's `packages` map (lockfileVersion 3). */
export interface LockEntry {
  version?: string;
  resolved?: string;
  integrity?: string;
  link?: boolean;
  inBundle?: boolean;
  hasInstallScript?: boolean;
  os?: string[];
  cpu?: string[];
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

export interface Lockfile {
  packages: Record<string, LockEntry>;
}

/** npm's os and cpu fields: a list of allowed values, or of `!value` exclusions. */
export function fieldAllows(list: string[] | undefined, values: readonly string[]): boolean {
  if (!list || list.length === 0) return true;
  return values.some((value) => {
    if (list.includes(`!${value}`)) return false;
    const allowed = list.filter((item) => !item.startsWith('!'));
    return allowed.length === 0 || allowed.includes(value);
  });
}

export function runsOn(entry: LockEntry, target: Target): boolean {
  return fieldAllows(entry.os, [target.platform]) && fieldAllows(entry.cpu, target.arches);
}

/** Where Node finds `name` from the package at `from`: its own node_modules, then each one above it. */
export function resolveFrom(packages: Record<string, LockEntry>, from: string, name: string): string | null {
  let base = from;
  for (;;) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const cut = base.lastIndexOf('/node_modules/');
    base = cut < 0 ? '' : base.slice(0, cut);
  }
}

/**
 * The lock paths of `roots` and everything they need at run time on `target`, found from the package at `from`
 * (the workspace that depends on the roots). Dependencies are required; optional ones and peers are taken when
 * the lock has them and they run on the target.
 */
export function dependencyClosure(lock: Lockfile, roots: readonly string[], target: Target, from = ''): string[] {
  const out = new Set<string>();
  const missing: string[] = [];
  const visit = (path: string) => {
    if (out.has(path)) return;
    const entry = lock.packages[path];
    if (entry.link) throw new Error(`${path} is a workspace link, not a package to ship`);
    out.add(path);
    const wants: [string, boolean][] = [
      ...Object.keys(entry.dependencies ?? {}).map((name): [string, boolean] => [name, true]),
      ...Object.keys(entry.optionalDependencies ?? {}).map((name): [string, boolean] => [name, false]),
      ...Object.keys(entry.peerDependencies ?? {}).map((name): [string, boolean] => [name, !entry.peerDependenciesMeta?.[name]?.optional]),
    ];
    for (const [name, required] of wants) {
      const found = resolveFrom(lock.packages, path, name);
      if (!found) {
        if (required) missing.push(`${name} (for ${path})`);
        continue;
      }
      if (!runsOn(lock.packages[found], target)) continue;
      visit(found);
    }
  };
  for (const root of roots) {
    const found = resolveFrom(lock.packages, from, root);
    if (!found) throw new Error(`package-lock.json has no ${root}`);
    visit(found);
  }
  if (missing.length) throw new Error(`package-lock.json is missing ${missing.join(', ')}`);
  return [...out].sort();
}

/**
 * Which of node-pty's files to ship. Its loader tries build/Release before prebuilds/<platform>-<arch>, so a Mac
 * build carries only the prebuilds for its arches, and Linux, which has none, only the addon compiled at install.
 * The C++ sources and winpty stay behind.
 */
export function keepPtyFile(rel: string, target: Target): boolean {
  const parts = rel.split('/');
  const top = parts[0];
  if (top === 'src' || top === 'deps' || top === 'third_party' || top === 'node-addon-api' || top === 'binding.gyp') return false;
  if (top === 'build') {
    if (target.platform !== 'linux') return false;
    return parts.length === 1 || (parts[1] === 'Release' && (parts.length === 2 || parts[2] === 'pty.node'));
  }
  if (top === 'prebuilds') {
    if (parts.length === 1) return target.platform === 'darwin';
    return target.arches.some((arch) => parts[1] === `${target.platform}-${arch}`);
  }
  return true;
}

/**
 * The newest glibc and libstdc++ a Linux AppImage may need: Debian 10, Ubuntu 18.10 and RHEL 8. Electron's own
 * binary needs less. A node-pty compiled on a current distro needs that distro's glibc (2.34 for forkpty, 2.42 for
 * cfsetospeed) and its libstdc++, so terminals would fail everywhere older.
 */
export const GLIBC_FLOOR = '2.28';
export const GLIBCXX_FLOOR = '3.4.25';

/** An image whose glibc (2.31) and libstdc++ (GCC 10) build an addon whose needs stay within the floor. */
const PORTABLE_PTY_IMAGE = 'node:24-bullseye';

export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/**
 * The newest GLIBC_ and GLIBCXX_ symbol versions an ELF file needs, read from its version names. A library that
 * only uses symbols lists only the versions it needs.
 */
export function elfVersionNeeds(bytes: Buffer): { glibc: string | null; glibcxx: string | null } {
  const text = bytes.toString('latin1');
  const newest = (pattern: RegExp) => {
    let best: string | null = null;
    for (const match of text.matchAll(pattern)) if (!best || compareVersions(match[1], best) > 0) best = match[1];
    return best;
  };
  return { glibc: newest(/GLIBC_(\d+(?:\.\d+)+)/g), glibcxx: newest(/GLIBCXX_(\d+(?:\.\d+)+)/g) };
}

/** What an addon needs beyond the floor, as readable lines. Empty when it runs on every supported distro. */
export function glibcProblems(bytes: Buffer): string[] {
  const { glibc, glibcxx } = elfVersionNeeds(bytes);
  const out: string[] = [];
  if (glibc && compareVersions(glibc, GLIBC_FLOOR) > 0) out.push(`glibc ${glibc} (the floor is ${GLIBC_FLOOR})`);
  if (glibcxx && compareVersions(glibcxx, GLIBCXX_FLOOR) > 0) out.push(`libstdc++ ${glibcxx} (the floor is ${GLIBCXX_FLOOR})`);
  return out;
}

/**
 * What is wrong with a staged node-pty for its target. A Mac's spawn-helper must be executable: node-pty's
 * prebuilds come as 0644, and a signed app cannot chmod its own files at run time. Linux's addon must stay within
 * the glibc floor, unless the build asked for this machine's.
 */
export function stagedPtyProblems(ptyDir: string, target: Target, hostGlibc = false): string[] {
  const problems: string[] = [];
  if (target.platform === 'darwin') {
    for (const arch of target.arches) {
      const helper = join(ptyDir, 'prebuilds', `darwin-${arch}`, 'spawn-helper');
      if (!existsSync(helper)) problems.push(`prebuilds/darwin-${arch}/spawn-helper is missing`);
      else if ((statSync(helper).mode & 0o111) !== 0o111) problems.push(`prebuilds/darwin-${arch}/spawn-helper is not executable`);
    }
    return problems;
  }
  const addon = join(ptyDir, 'build', 'Release', 'pty.node');
  if (!existsSync(addon)) return ['build/Release/pty.node is missing'];
  if (!hostGlibc) for (const need of glibcProblems(readFileSync(addon))) problems.push(`build/Release/pty.node needs ${need}`);
  return problems;
}

/**
 * Why the repo's copy of a closure package cannot ship, or null when it can. It must be installed at the locked
 * version. One with an install script may hold files built for this machine (a native binary), so it ships only to
 * this machine's platform and arch. node-pty has an install script and its own branch in installClosure.
 */
export function copyProblem(path: string, entry: LockEntry, installed: string | null, hostTarget: boolean): string | null {
  if (installed !== entry.version) return `${path} is ${installed ?? 'not installed'}, not the locked ${entry.version}. Run npm install --include=dev.`;
  if (entry.hasInstallScript && !hostTarget) return `${path} has an install script, so the repo's copy is built for this machine only`;
  return null;
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with ${result.status ?? result.signal}`);
}

const say = (text: string) => console.log(`==> ${text}`);

function dockerUsable(): boolean {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
}

/**
 * Compiles node-pty's addon in PORTABLE_PTY_IMAGE, from the repo's copy of its sources, and returns its path. The
 * result is cached per node-pty version and arch. N-API keeps it loadable on Electron's Node.
 */
function buildPortablePty(src: string, version: string, arch: Arch): string {
  const work = join(CACHE_DIR, `node-pty-${version}-linux-${arch}`);
  const pkg = join(work, 'node_modules', 'node-pty');
  const addon = join(pkg, 'build', 'Release', 'pty.node');
  if (existsSync(addon) && glibcProblems(readFileSync(addon)).length === 0) return addon;
  rmSync(work, { recursive: true, force: true });
  // build/ and node-addon-api/ hold this machine's compile; without prebuilds/linux-*, the install script compiles.
  cpSync(src, pkg, {
    recursive: true,
    filter: (file) => !/^(build|prebuilds|node-addon-api)(\/|$)/.test(relative(src, file).split(sep).join('/')),
  });
  cpSync(join(REPO, 'node_modules', 'node-addon-api'), join(work, 'node_modules', 'node-addon-api'), { recursive: true });
  writeFileSync(join(work, 'package.json'), '{ "name": "omni-pty-build", "private": true }\n');
  say(`Compiling node-pty ${version} for linux-${arch} in ${PORTABLE_PTY_IMAGE}`);
  const user = process.getuid && process.getgid ? ['--user', `${process.getuid()}:${process.getgid()}`] : [];
  run(
    'docker',
    ['run', '--rm', '--platform', `linux/${arch === 'x64' ? 'amd64' : 'arm64'}`, ...user, '-e', 'HOME=/tmp', '-v', `${work}:/w`, '-w', '/w', PORTABLE_PTY_IMAGE, 'npm', 'rebuild', 'node-pty', '--foreground-scripts'],
    work,
  );
  if (!existsSync(addon)) throw new Error(`the container build left no ${relative(REPO, addon)}`);
  return addon;
}

/**
 * The pty.node a Linux build ships: the repo's when it stays within the glibc floor, else one compiled in an older
 * distro's container. --host-glibc ships the repo's as it is, for a build that only has to run here.
 */
function linuxPtyAddon(src: string, version: string, arch: Arch, hostGlibc: boolean): string {
  const local = join(src, 'build', 'Release', 'pty.node');
  if (!existsSync(local)) throw new Error('node-pty has no build/Release/pty.node. Build it on Linux with: npm rebuild node-pty');
  const needs = glibcProblems(readFileSync(local));
  if (needs.length === 0) return local;
  if (hostGlibc) {
    say(`Shipping this machine's node-pty, which needs ${needs.join(' and ')}. This build only runs where those are`);
    return local;
  }
  if (dockerUsable()) return buildPortablePty(src, version, arch);
  throw new Error(
    `node_modules/node-pty/build/Release/pty.node needs ${needs.join(' and ')}, so terminals would fail on most distros. ` +
      `Let stage.ts compile it in ${PORTABLE_PTY_IMAGE} (it needs a working docker), ` +
      'or pass --host-glibc for a build that only runs on machines like this one.',
  );
}

function localVersion(dir: string): string | null {
  try {
    return (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

/** Copies each package of the closure from the repo to the same lock path under `out`, so Node resolves them as it does in the repo. */
function installClosure(lock: Lockfile, paths: string[], target: Target, out: string, hostGlibc: boolean): void {
  const hostTarget = target.platform === process.platform && target.arches.length === 1 && target.arches[0] === process.arch;
  const problems = paths
    .filter((path) => !path.endsWith('node_modules/node-pty') && !lock.packages[path].inBundle)
    .map((path) => copyProblem(path, lock.packages[path], localVersion(join(REPO, path)), hostTarget))
    .filter((problem) => problem !== null);
  if (problems.length) throw new Error(`cannot ship the externals' packages: ${problems.join('; ')}`);
  for (const path of paths) {
    const entry = lock.packages[path];
    const src = join(REPO, path);
    const dest = join(out, path);
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (entry.inBundle && existsSync(dest)) continue;
    if (name === 'node-pty') {
      const version = entry.version ?? '';
      if (localVersion(src) !== version) throw new Error(`node_modules/node-pty is not ${version}. Run npm install --include=dev.`);
      const addon = target.platform === 'linux' ? linuxPtyAddon(src, version, target.arches[0], hostGlibc) : null;
      cpSync(src, dest, { recursive: true, filter: (file) => file === src || keepPtyFile(relative(src, file).split(sep).join('/'), target) });
      if (addon) cpSync(addon, join(dest, 'build', 'Release', 'pty.node'));
      for (const arch of target.platform === 'darwin' ? target.arches : []) {
        const helper = join(dest, 'prebuilds', `darwin-${arch}`, 'spawn-helper');
        if (existsSync(helper)) chmodSync(helper, 0o755);
      }
      const problems = stagedPtyProblems(dest, target, hostGlibc);
      if (problems.length) throw new Error(`staged node-pty: ${problems.join('; ')}`);
      continue;
    }
    const nested = join(src, 'node_modules');
    cpSync(src, dest, { recursive: true, filter: (file) => file !== nested });
  }
}

function stampPackageJson(out: string): string {
  const root = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as Record<string, unknown>;
  const { version } = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')) as { version: string };
  const { name, description, type, engines } = root;
  writeFileSync(join(out, 'package.json'), `${JSON.stringify({ name, version, private: true, description, type, engines }, null, 2)}\n`);
  return version;
}

/** Electron's binary for this machine, from the electron package, which answers its path when required from Node. */
function electronBinary(): string {
  return createRequire(import.meta.url)('electron') as unknown as string;
}

/**
 * The staged tree works on Electron's Node: each external resolves from the server bundle's folder, and node-pty
 * loads its addon and runs /bin/echo in a pseudoterminal. Only for a target this machine can run.
 */
function checkOnElectron(out: string): void {
  const script = `
    const { createRequire } = require('node:module');
    const req = createRequire(${JSON.stringify(join(out, 'apps', 'server', 'index.mjs'))});
    for (const name of ${JSON.stringify(EXTERNALS)}) req.resolve(name + '/package.json');
    const pty = req('node-pty');
    const term = pty.spawn('/bin/echo', ['omni-pty-ok'], { cols: 80, rows: 24 });
    let text = '';
    term.onData((d) => { text += d; });
    term.onExit(({ exitCode }) => {
      if (exitCode !== 0 || !text.includes('omni-pty-ok')) { console.error('node-pty: echo said ' + JSON.stringify(text)); process.exit(1); }
      console.log('node-pty ' + process.platform + '-' + process.arch + ' on Node ' + process.versions.node + ': ok');
      process.exit(0);
    });
    setTimeout(() => { console.error('node-pty: no exit'); process.exit(1); }, 10000);
  `;
  run(electronBinary(), ['-e', script], out, { ...process.env, ELECTRON_RUN_AS_NODE: '1' });
}

function sizeOf(dir: string): number {
  let total = 0;
  for (const item of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (item.isFile()) total += statSync(join(item.parentPath, item.name)).size;
  }
  return total;
}

export async function stage(args: StageArgs, out = STAGE_DIR): Promise<void> {
  const { target } = args;
  const label = `${target.platform}-${target.arches.join('+')}`;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  say(`Bundling the server and MCP scripts (${label})`);
  run('npx', ['--no-install', 'tsx', join(REPO, 'apps/server/scripts/bundle.ts'), out], REPO);

  const webDist = join(REPO, 'apps/web/dist');
  if (!args.skipWeb) {
    say('Building the Web UI');
    run('npm', ['run', 'build', '-w', '@omni/web'], REPO);
  }
  if (!existsSync(join(webDist, 'index.html'))) throw new Error('apps/web/dist has no index.html. Run without --skip-web.');
  cpSync(webDist, join(out, 'apps/web/dist'), { recursive: true });

  for (const dir of SHIPPED_DIRS) cpSync(join(REPO, dir), join(out, dir), { recursive: true });
  const version = stampPackageJson(out);

  say('Copying node_modules for the externals');
  const lock = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8')) as Lockfile;
  const paths = dependencyClosure(lock, EXTERNALS, target, 'apps/server');
  installClosure(lock, paths, target, out, args.hostGlibc);
  say(`${paths.length} packages copied`);

  if (target.platform === process.platform && target.arches.includes(process.arch as Arch)) {
    say('Checking the staged tree on Electron');
    checkOnElectron(out);
  } else {
    say(`Skipping the Electron check: this machine cannot run ${label}`);
  }
  say(`Staged Omni ${version} for ${label} in ${relative(process.cwd(), out) || out} (${Math.round(sizeOf(out) / 1e6)} MB)`);
}

if (import.meta.main) {
  const parsed = parseStageArgs(process.argv.slice(2), process);
  if ('error' in parsed) {
    console.error(`stage: ${parsed.error}`);
    process.exit(2);
  }
  try {
    await stage(parsed);
  } catch (err) {
    console.error(`stage: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

