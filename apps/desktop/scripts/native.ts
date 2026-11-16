// Builds the Rust binaries the app ships (crates/, docs/internals/rust-port.md) for one target and puts them in
// <out>/bin, where the server looks for them (apps/server/native-mcp.ts). stage.ts calls it.
//
// A Linux binary is linked statically against musl, so it runs on any distro whatever its glibc. A universal Mac
// build compiles both arches and joins them with lipo, and the app merge then leaves the file as it is.
// Without cargo the app still builds: the server starts the TypeScript servers when the binary is not there.
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Arch, Target } from './stage.ts';

const DESKTOP = resolve(import.meta.dirname, '..');
const REPO = resolve(DESKTOP, '../..');
/** Cargo's output for app builds, apart from a developer's own target/, so a build never ships a stale binary from there. */
const TARGET_DIR = join(DESKTOP, 'build', 'cache', 'cargo-target');

/** The binaries, by crate and file name. Each is staged as bin/<name> under the app root. */
export const NATIVE_BINARIES = ['omni-mcp'] as const;
export const NATIVE_DIR = 'bin';

/** `auto` builds when cargo is here and goes on without the binaries when it is not. `required` fails instead. */
export type NativeMode = 'auto' | 'required' | 'off';
export const NATIVE_MODES: readonly NativeMode[] = ['auto', 'required', 'off'];

/** The Rust target for one platform and arch. */
export function rustTriple(platform: Target['platform'], arch: Arch): string {
  const cpu = arch === 'arm64' ? 'aarch64' : 'x86_64';
  return platform === 'darwin' ? `${cpu}-apple-darwin` : `${cpu}-unknown-linux-musl`;
}

const say = (text: string) => console.log(`==> ${text}`);

function ran(command: string, args: string[], inherit = false): { ok: boolean; out: string } {
  const result = spawnSync(command, args, { cwd: REPO, encoding: 'utf8', stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

/** What is wrong with a staged binary for its target, as readable lines. Empty when it can ship. */
export function stagedNativeProblems(file: string, target: Target, archsOf: (file: string) => string[] = machoArchs): string[] {
  if (!existsSync(file)) return [`${file} is missing`];
  const problems: string[] = [];
  if ((statSync(file).mode & 0o111) !== 0o111) problems.push(`${file} is not executable`);
  if (target.platform === 'linux') {
    // A static binary names no GLIBC_ version. One that does was linked against this machine's glibc.
    if (/GLIBC_\d/.test(readFileSync(file).toString('latin1'))) problems.push(`${file} needs glibc: it must be a static musl build`);
    return problems;
  }
  const have = archsOf(file);
  for (const arch of target.arches) {
    const want = arch === 'arm64' ? 'arm64' : 'x86_64';
    if (!have.includes(want)) problems.push(`${file} has no ${want} slice (it has ${have.join(', ') || 'none'})`);
  }
  return problems;
}

function machoArchs(file: string): string[] {
  const result = ran('lipo', ['-archs', file]);
  return result.ok ? result.out.split(/\s+/).filter(Boolean) : [];
}

/**
 * Builds every binary for `target` into <out>/bin. Returns whether the staged app carries them. In `auto` mode a
 * machine without cargo, or a build that fails, leaves them out with a line saying so.
 */
export function stageNative(target: Target, out: string, mode: NativeMode): boolean {
  if (mode === 'off') {
    say('Leaving the Rust binaries out (--native off)');
    return false;
  }
  try {
    build(target, out);
    return true;
  } catch (err) {
    if (mode === 'required') throw err;
    say(`No Rust binaries in this build: ${err instanceof Error ? err.message : String(err)}`);
    say('The app runs the TypeScript MCP servers instead. Pass --native required to fail here');
    return false;
  }
}

function build(target: Target, out: string): void {
  // Every command runs from the repo root, where rust-toolchain.toml pins the toolchain. With rustup, this installs
  // that toolchain when it is missing, which a build machine's first run needs. An older rustup wants a name here
  // and fails, and cargo then says below whether there is a toolchain.
  const rustup = ran('rustup', ['--version']).ok;
  if (rustup) ran('rustup', ['toolchain', 'install'], true);
  if (!ran('cargo', ['--version']).ok) throw new Error('cargo did not run. Install Rust from https://rustup.rs');
  const triples = target.arches.map((arch) => rustTriple(target.platform, arch));
  for (const triple of triples) {
    if (rustup && !ran('rustup', ['target', 'add', triple], true).ok) throw new Error(`rustup could not add the target ${triple}`);
    say(`Compiling ${NATIVE_BINARIES.join(', ')} for ${triple}`);
    const packages = NATIVE_BINARIES.flatMap((name) => ['-p', name]);
    if (!ran('cargo', ['build', '--release', '--locked', '--target', triple, '--target-dir', TARGET_DIR, ...packages], true).ok) {
      throw new Error(`cargo build failed for ${triple}`);
    }
  }
  mkdirSync(join(out, NATIVE_DIR), { recursive: true });
  for (const name of NATIVE_BINARIES) {
    const built = triples.map((triple) => join(TARGET_DIR, triple, 'release', name));
    const dest = join(out, NATIVE_DIR, name);
    if (built.length === 1) cpSync(built[0], dest);
    else if (!ran('lipo', ['-create', '-output', dest, ...built], true).ok) throw new Error(`lipo could not join ${name}`);
    chmodSync(dest, 0o755);
    const problems = stagedNativeProblems(dest, target);
    if (problems.length) throw new Error(problems.join('; '));
    if (target.platform === process.platform && target.arches.includes(process.arch as Arch)) {
      const version = ran(dest, ['--version']);
      if (!version.ok || !version.out.startsWith(`${name} `)) throw new Error(`${dest} --version said ${JSON.stringify(version.out)}`);
      say(`${version.out} for ${target.platform}-${target.arches.join('+')}: ok`);
    }
  }
}
