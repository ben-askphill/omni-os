// The `omni` command (apps/cli, docs/user/cli.md, ADR 0014): a shell script this app writes each time it starts. It
// runs the CLI bundled under the app's resources on the app's own binary, acting as Node, so the command updates
// with the app and needs no Node on the machine. One copy goes in the app's bin folder, which the server puts on its
// threads' PATH (backend/index.ts), so agents in every local harness have it. The other goes in ~/.local/bin for
// terminals, unless something there that is not Omni's already has the name.
import { lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** On every shim, so a later launch knows the file is Omni's to replace. */
export const SHIM_MARK = '# omni-cli-shim';

/** Where the bundled CLI sits under the app's resources: apps/cli/scripts/bundle.ts writes it, scripts/stage.ts stages it. */
export const CLI_SCRIPT = ['omni', 'apps', 'cli', 'omni.mjs'] as const;

export interface ShimFacts {
  /** What runs: the AppImage file on Linux (the binary inside lives in a mount that goes away), else this binary. */
  app: string;
  dataDir: string;
  logFile: string;
  port: number;
}

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/**
 * Node's `-e`, so the script's path comes from the app's own resources at run time: an AppImage mounts somewhere new
 * each time. The bundle exports `run(argv)` (apps/cli/src/main.ts) and answers the exit code.
 */
export const BOOT =
  `import(require("node:url").pathToFileURL(require("node:path").join(process.resourcesPath,${CLI_SCRIPT.map((p) => JSON.stringify(p)).join(',')})).href)` +
  '.then((m)=>m.run(process.argv.slice(1))).then((code)=>{process.exitCode=code})';

export function shimText(f: ShimFacts): string {
  return [
    '#!/bin/sh',
    "# omni: Omni's command line (docs/user/cli.md). The Omni desktop app writes this file each time it starts.",
    `${SHIM_MARK} 1`,
    `export OMNI_APP=${quote(f.app)}`,
    `export OMNI_INSTALL_DATA_DIR=${quote(f.dataDir)}`,
    `export OMNI_INSTALL_LOG=${quote(f.logFile)}`,
    `export OMNI_INSTALL_PORT=${f.port}`,
    'if [ ! -x "$OMNI_APP" ]; then',
    '  echo "omni: $OMNI_APP is gone. Open the Omni app once and it points this command at itself again." >&2',
    '  exit 3',
    'fi',
    `ELECTRON_RUN_AS_NODE=1 exec "$OMNI_APP" -e ${quote(BOOT)} -- "$@"`,
    '',
  ].join('\n');
}

/** What is at the path the shim goes to. */
export type Existing = { kind: 'none' } | { kind: 'file'; text: string } | { kind: 'link'; target: string; dangling: boolean } | { kind: 'other' };

export type Plan = { action: 'write' } | { action: 'keep' } | { action: 'skip'; reason: string };

/**
 * Omni's command-line launchers from before this one: the control script for the old Linux service
 * (omni-os.service, scripts/omni-linux.sh, deleted in #528) and scripts/omni.sh, which this command replaces.
 */
export function legacyLauncher(text: string): boolean {
  return /^SERVICE=omni-os$/m.test(text) || text.includes('scripts/omni-linux.sh') || text.includes('# Quick capture into Omni OS from any terminal.');
}

export function planShim(existing: Existing, text: string): Plan {
  switch (existing.kind) {
    case 'none':
      return { action: 'write' };
    case 'file':
      if (existing.text === text) return { action: 'keep' };
      if (existing.text.includes(SHIM_MARK) || legacyLauncher(existing.text)) return { action: 'write' };
      return { action: 'skip', reason: 'another program named omni is there' };
    case 'link':
      // A link to a checkout's scripts/omni.sh is how that script told people to install it.
      if (existing.dangling || /[\\/]scripts[\\/]omni\.sh$/.test(existing.target)) return { action: 'write' };
      return { action: 'skip', reason: `it links to ${existing.target}` };
    case 'other':
      return { action: 'skip', reason: 'it is not a file' };
  }
}

export function readExisting(path: string): Existing {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return { kind: 'none' };
  }
  if (st.isSymbolicLink()) {
    const target = resolve(dirname(path), readlinkSync(path));
    let dangling = false;
    try {
      statSync(path);
    } catch {
      dangling = true;
    }
    return { kind: 'link', target, dangling };
  }
  if (!st.isFile()) return { kind: 'other' };
  try {
    // A shim is a few hundred bytes; a large file is someone's program, read only far enough to tell.
    return { kind: 'file', text: readFileSync(path, 'utf8').slice(0, 64 * 1024) };
  } catch {
    return { kind: 'other' };
  }
}

/** Writes beside it and renames over it, so a running `omni` never reads half a file and a link is replaced, not followed. */
function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, text, { mode: 0o755 });
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}

export type InstallResult = { path: string; result: 'written' | 'kept' } | { path: string; result: 'skipped'; reason: string };

export function installShim(path: string, text: string): InstallResult {
  const plan = planShim(readExisting(path), text);
  if (plan.action === 'skip') return { path, result: 'skipped', reason: plan.reason };
  if (plan.action === 'keep') return { path, result: 'kept' };
  writeAtomic(path, text);
  return { path, result: 'written' };
}

/**
 * Whether this launch may claim `~/.local/bin/omni`: the installed app on its default port, data dir and profile, run
 * from where it lives. A dev, QA or `--data-dir` launch would point everyone's command at its throwaway server, and a
 * Mac app run from the disk image or a quarantined download runs from a path that goes away.
 */
export function ownsUserCommand(input: { packaged: boolean; dev: boolean; customDataDir: boolean; defaultPort: boolean; customUserData: boolean; app: string }): boolean {
  if (!input.packaged || input.dev || input.customDataDir || !input.defaultPort || input.customUserData) return false;
  return !input.app.includes('/AppTranslocation/') && !input.app.startsWith('/Volumes/') && !input.app.startsWith('/tmp/.mount_');
}

export interface CommandLineInput {
  facts: ShimFacts;
  /** The app's bin folder, on the server's PATH. */
  binDir: string;
  /** ~/.local/bin/omni, or null when this launch must not claim it. */
  userPath: string | null;
}

/** Writes both shims. Never throws: the app runs without the command. */
export function installCommandLine(input: CommandLineInput): InstallResult[] {
  const text = shimText(input.facts);
  const out: InstallResult[] = [];
  for (const path of [join(input.binDir, 'omni'), input.userPath]) {
    if (!path) continue;
    try {
      out.push(installShim(path, text));
    } catch (err) {
      out.push({ path, result: 'skipped', reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
