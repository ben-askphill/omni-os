// Signs the release's Mac app with Apple's codesign. The release workflow's sign job runs it on plain Node
// (.github/workflows/desktop-release.yml). That job holds the Developer ID and runs no package code, so this file
// imports only Node's built-ins and ./codesign-retry.cjs (tests/release-workflow.test.ts holds it to that).
//
//   node apps/desktop/scripts/mac-release-sign.ts --identity <hash> --keychain <path> --entitlements <plist> <Omni.app>
//
// It signs as electron-builder's signing did (@electron/osx-sign): every nested Mach-O file, .app and .framework,
// deepest first, then the app, each forced, timestamped, with the hardened runtime and the same entitlements. It skips
// what is not code (fonts, images, .pak), which the bundle's own signature seals. Then it verifies the app.
//
// The app comes from a build job that ran package code, so before signing it refuses a link that leads out of the app
// and anything that is not a file, folder or link (bundleProblems).
import { execFile } from 'node:child_process';
import { closeSync, openSync, readSync, readdirSync, readlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const { retrySigning } = require('./codesign-retry.cjs') as {
  retrySigning: <T>(attempt: () => Promise<T>, deps: { wait?: (seconds: number) => Promise<void>; log?: (message: string) => void }) => Promise<T>;
};

export interface SignOptions {
  app: string;
  /** The Developer ID Application identity's SHA-1 hash, as `security find-identity` prints it. */
  identity: string;
  keychain: string;
  entitlements: string;
}

export interface SignDeps {
  codesign?: (args: string[]) => Promise<void>;
  wait?: (seconds: number) => Promise<void>;
  log?: (message: string) => void;
}

/** Mach-O's magic numbers, either byte order: 32-bit, 64-bit, and the universal (fat) wrappers. */
const MACHO_MAGIC = new Set([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]);

/** True when `header`, a file's first bytes, starts a Mach-O file. */
export function isMachO(header: Uint8Array): boolean {
  if (header.length < 4) return false;
  return MACHO_MAGIC.has(((header[0] << 24) | (header[1] << 16) | (header[2] << 8) | header[3]) >>> 0);
}

function readHeader(path: string): Uint8Array {
  const fd = openSync(path, 'r');
  try {
    const header = new Uint8Array(4);
    const read = readSync(fd, header, 0, 4, 0);
    return header.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/**
 * Why the app at `app` may not be signed: each link that is absolute or leads out of the app, and each entry that is
 * not a file, folder or link (a pipe, a device), as paths inside the app. Empty when there is none.
 */
export function bundleProblems(app: string): string[] {
  const problems: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const inside = relative(app, path);
      if (entry.isSymbolicLink()) {
        const target = readlinkSync(path);
        const lands = relative(app, resolve(dirname(path), target));
        if (isAbsolute(target) || lands === '..' || lands.startsWith(`..${sep}`) || isAbsolute(lands)) {
          problems.push(`${inside} links to ${target}, outside the app`);
        }
      } else if (entry.isDirectory()) {
        walk(path);
      } else if (!entry.isFile()) {
        problems.push(`${inside} is not a file, folder or link`);
      }
    }
  };
  walk(app);
  return problems.sort();
}

/**
 * What codesign signs, in order: each Mach-O file and each .app or .framework inside the app, deepest first, then the
 * app. Symlinks are skipped, so a framework's Versions/Current and its top-level links are signed through their target.
 */
export function signingOrder(app: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(path);
        if (extname(path) === '.app' || extname(path) === '.framework') found.push(path);
      } else if (entry.isFile() && isMachO(readHeader(path))) {
        found.push(path);
      }
    }
  };
  walk(join(app, 'Contents'));
  const depth = (path: string) => path.split(sep).length;
  found.sort((a, b) => depth(b) - depth(a) || (a < b ? -1 : a > b ? 1 : 0));
  return [...found, app];
}

/** codesign's arguments for one path, as @electron/osx-sign built them for electron-builder. */
export function codesignArgs(path: string, opts: SignOptions): string[] {
  return [
    '--sign',
    opts.identity,
    '--force',
    '--keychain',
    opts.keychain,
    '--timestamp',
    '--options',
    'runtime',
    '--entitlements',
    opts.entitlements,
    path,
  ];
}

const execFileAsync = promisify(execFile);

async function runCodesign(args: string[]): Promise<void> {
  try {
    await execFileAsync('codesign', args, { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    throw new Error(`codesign ${args.slice(-1)[0]} failed: ${stderr.trim() || (error as Error).message}`);
  }
}

/** Signs every path signingOrder lists, each one tried again as codesign-retry.cjs says, then verifies the app. */
export async function signApp(opts: SignOptions, deps: SignDeps = {}): Promise<string[]> {
  const codesign = deps.codesign ?? runCodesign;
  const log = deps.log ?? ((message: string) => console.log(message));
  const problems = bundleProblems(opts.app);
  if (problems.length) throw new Error(`refusing to sign ${opts.app}: ${problems.join('; ')}`);
  const order = signingOrder(opts.app);
  for (const path of order) {
    await retrySigning(() => codesign(codesignArgs(path, opts)), { wait: deps.wait, log });
  }
  log(`  • signed ${order.length} files and bundles`);
  await codesign(['--verify', '--deep', '--strict', '--verbose=2', opts.app]);
  return order;
}

export function parseSignArgs(argv: readonly string[]): SignOptions | { error: string } {
  const named: Record<string, string> = {};
  const apps: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--identity' || arg === '--keychain' || arg === '--entitlements') named[arg.slice(2)] = argv[++i] ?? '';
    else if (arg.startsWith('-')) return { error: `unknown option ${arg}` };
    else apps.push(arg);
  }
  for (const name of ['identity', 'keychain', 'entitlements']) if (!named[name]) return { error: `needs --${name}` };
  if (apps.length !== 1 || !apps[0].endsWith('.app')) return { error: 'needs one .app' };
  return { app: apps[0], identity: named.identity, keychain: named.keychain, entitlements: named.entitlements };
}

if (import.meta.main) {
  const parsed = parseSignArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(`mac-release-sign: ${parsed.error}`);
    process.exit(2);
  }
  signApp(parsed).catch((err: unknown) => {
    console.error(`mac-release-sign: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
