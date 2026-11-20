// Packs the release's signed Mac app into what a release ships: the DMG, the zip, a block map of each and the update
// feed (latest-mac.yml). The release workflow's sign job runs it on plain Node, after the app is signed and stapled
// (.github/workflows/desktop-release.yml). That job holds the Developer ID and runs no package code, so this file
// imports only Node's built-ins (tests/release-workflow.test.ts holds it to that) and runs only Apple's ditto, hdiutil
// and xattr. It changes nothing inside the app.
//
//   node apps/desktop/scripts/mac-release-package.ts --version <x.y.z> --out <folder> [--arch universal] <Omni.app>
//
// It writes what electron-builder wrote before, under the same names:
//
//   Omni-<version>-mac-<arch>.zip            what the updater downloads and Squirrel.Mac installs from
//   Omni-<version>-mac-<arch>.zip.blockmap   lets the updater download only the parts of the zip that changed
//   Omni-<version>-mac-<arch>.dmg            what a person downloads: the app beside a link to /Applications
//   Omni-<version>-mac-<arch>.dmg.blockmap   nothing reads it; a release has always carried it
//   latest-mac.yml                           the feed electron-updater reads (src/updates.ts)
//
// The DMG's window (background, icon places) is resources/dmg/DS_Store, made once. Its background is found by the
// volume's name, so the volume is always "Omni", without the version.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const RESOURCES = resolve(import.meta.dirname, '../resources');

export interface PackageOptions {
  app: string;
  version: string;
  arch: string;
  out: string;
}

/** The release's Mac file names for a version, as electron-builder's artifactName spelled them. */
export function releaseNames(version: string, arch: string): { zip: string; dmg: string; feed: string; all: string[] } {
  const base = `Omni-${version}-mac-${arch}`;
  const zip = `${base}.zip`;
  const dmg = `${base}.dmg`;
  return { zip, dmg, feed: 'latest-mac.yml', all: [dmg, `${dmg}.blockmap`, zip, `${zip}.blockmap`, 'latest-mac.yml'] };
}

export function parseArgs(argv: string[]): PackageOptions | { error: string } {
  const options: Record<string, string> = { arch: 'universal' };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--version' || arg === '--out' || arg === '--arch') {
      const value = argv[++i];
      if (!value || value.startsWith('-')) return { error: `${arg} needs a value` };
      options[arg.slice(2)] = value;
    } else if (arg.startsWith('-')) return { error: `unknown option ${arg}` };
    else rest.push(arg);
  }
  if (rest.length !== 1) return { error: 'name one app to pack' };
  if (!options.version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(options.version)) return { error: '--version needs a version such as 0.2.0' };
  if (!options.out) return { error: '--out needs the folder the release files go to' };
  if (!/^[a-z0-9]+$/.test(options.arch)) return { error: '--arch needs a name such as universal' };
  return { app: resolve(rest[0]), version: options.version, arch: options.arch, out: resolve(options.out) };
}

// --- Block maps ---------------------------------------------------------------------------------------------------
// A block map lists a file's blocks in order, each with its size and a checksum. The updater compares the installed
// version's map with the new one and downloads only the blocks whose checksum the old file lacks
// (electron-updater's downloadPlanBuilder). It never recomputes a checksum: it checks the finished file against the
// feed's sha512. So a checksum only has to be the same for the same bytes, here the first 18 bytes of their SHA-256,
// the length electron-builder's had. A block ends where a rolling hash of the last bytes says so, so bytes that only
// moved (a zip entry after one that grew) still fall into the same blocks.

const BLOCK_MIN = 8 * 1024;
const BLOCK_MAX = 32 * 1024;
/** A block ends when these bits of the rolling hash are all zero: one position in 16384 after the minimum, so blocks average about 20 KB as electron-builder's did. */
const BLOCK_MASK = 0x3fff0000;

/** A fixed pseudo-random number per byte value for the rolling hash, from SHA-256 so every run has the same ones. */
const GEAR = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) table[i] = createHash('sha256').update(`omni-block-map-${i}`).digest().readUInt32LE(0);
  return table;
})();

export interface BlockMapFile {
  name: string;
  offset: number;
  checksums: string[];
  sizes: number[];
}

/** Splits a stream of chunks into blocks. `end()` closes the last one. */
export class BlockSplitter {
  readonly checksums: string[] = [];
  readonly sizes: number[] = [];
  #hash = 0;
  #size = 0;
  #digest = createHash('sha256');

  push(chunk: Uint8Array): void {
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      this.#hash = ((this.#hash << 1) + GEAR[chunk[i]]) >>> 0;
      this.#size++;
      if ((this.#size >= BLOCK_MIN && (this.#hash & BLOCK_MASK) === 0) || this.#size >= BLOCK_MAX) {
        this.#digest.update(chunk.subarray(start, i + 1));
        this.#close();
        start = i + 1;
      }
    }
    if (start < chunk.length) this.#digest.update(chunk.subarray(start));
  }

  end(): void {
    if (this.#size > 0) this.#close();
  }

  #close(): void {
    this.checksums.push(this.#digest.digest().subarray(0, 18).toString('base64'));
    this.sizes.push(this.#size);
    this.#digest = createHash('sha256');
    this.#hash = 0;
    this.#size = 0;
  }
}

/** Reads the file once: its block map, its sha512 as the feed spells it (base64), and its size. */
export function describeFile(path: string): { blockMap: { version: '2'; files: BlockMapFile[] }; sha512: string; size: number } {
  const splitter = new BlockSplitter();
  const sha512 = createHash('sha512');
  const buffer = new Uint8Array(1024 * 1024);
  const fd = openSync(path, 'r');
  let size = 0;
  try {
    for (let read = readSync(fd, buffer, 0, buffer.length, null); read > 0; read = readSync(fd, buffer, 0, buffer.length, null)) {
      const chunk = buffer.subarray(0, read);
      splitter.push(chunk);
      sha512.update(chunk);
      size += read;
    }
  } finally {
    closeSync(fd);
  }
  splitter.end();
  return { blockMap: { version: '2', files: [{ name: 'file', offset: 0, checksums: splitter.checksums, sizes: splitter.sizes }] }, sha512: sha512.digest('base64'), size };
}

// --- The update feed ------------------------------------------------------------------------------------------------

export interface FeedFile {
  name: string;
  sha512: string;
  size: number;
}

/** latest-mac.yml as electron-builder wrote it: the zip first, since Squirrel.Mac installs only from the zip. */
export function feedText(version: string, zip: FeedFile, dmg: FeedFile, releaseDate: Date): string {
  const entry = (file: FeedFile) => [`  - url: ${file.name}`, `    sha512: ${file.sha512}`, `    size: ${file.size}`];
  return [`version: ${version}`, 'files:', ...entry(zip), ...entry(dmg), `path: ${zip.name}`, `sha512: ${zip.sha512}`, `releaseDate: '${releaseDate.toISOString()}'`, ''].join('\n');
}

// --- The zip and the DMG --------------------------------------------------------------------------------------------

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

/** A copy without extended attributes, resource forks, quarantine or ACLs: the signature and the ticket are files. */
const PLAIN = ['--norsrc', '--noextattr', '--noqtn', '--noacl'];

function makeZip(app: string, zip: string): void {
  run('/usr/bin/ditto', ['-c', '-k', ...PLAIN, '--keepParent', app, zip]);
}

/** The bytes of every file under `dir`, for sizing the DMG's volume. */
function bytesUnder(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += bytesUnder(path);
    else total += lstatSync(path).size + 4096;
  }
  return total;
}

/** The Finder info that marks a folder as having a custom icon (.VolumeIcon.icns on a volume). */
const HAS_CUSTOM_ICON = '0000000000000000040000000000000000000000000000000000000000000000';

function makeDmg(app: string, dmg: string, work: string): void {
  const image = join(work, 'volume.dmg');
  const mount = join(work, 'volume');
  const megabytes = Math.ceil((bytesUnder(app) * 1.05) / (1024 * 1024)) + 32;
  run('/usr/bin/hdiutil', ['create', '-size', `${megabytes}m`, '-fs', 'HFS+', '-volname', 'Omni', '-layout', 'GPTSPUD', '-type', 'UDIF', image]);
  mkdirSync(mount);
  run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-noverify', '-noautoopen', '-mountpoint', mount, image]);
  try {
    run('/usr/bin/ditto', [...PLAIN, app, join(mount, 'Omni.app')]);
    symlinkSync('/Applications', join(mount, 'Applications'));
    copyFileSync(join(RESOURCES, 'dmg/DS_Store'), join(mount, '.DS_Store'));
    copyFileSync(join(RESOURCES, 'dmg/background.tiff'), join(mount, '.background.tiff'));
    copyFileSync(join(RESOURCES, 'icon.icns'), join(mount, '.VolumeIcon.icns'));
    run('/usr/bin/xattr', ['-wx', 'com.apple.FinderInfo', HAS_CUSTOM_ICON, mount]);
    // What macOS writes on a volume it mounts for writing. Nothing a download needs.
    for (const name of ['.fseventsd', '.Trashes']) rmSync(join(mount, name), { recursive: true, force: true });
  } finally {
    detach(mount);
  }
  run('/usr/bin/hdiutil', ['convert', image, '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-o', dmg]);
}

/** Detaches the volume, waiting out whatever still reads it (Spotlight, on a runner). */
function detach(mount: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      run('/usr/bin/hdiutil', ['detach', mount]);
      return;
    } catch (err) {
      if (attempt === 5) {
        run('/usr/bin/hdiutil', ['detach', '-force', mount]);
        return;
      }
      console.log(`hdiutil detach failed (attempt ${attempt}), trying again: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
      execFileSync('/bin/sleep', [String(attempt * 2)]);
    }
  }
}

export function packageMac(options: PackageOptions, now = new Date()): string[] {
  const { app, version, arch, out } = options;
  if (!existsSync(join(app, 'Contents/Info.plist')) || lstatSync(app).isSymbolicLink()) throw new Error(`${app} is not an app`);
  const names = releaseNames(version, arch);
  mkdirSync(out, { recursive: true });
  for (const name of names.all) {
    if (existsSync(join(out, name))) throw new Error(`${join(out, name)} is there already`);
  }
  const work = mkdtempSync(join(tmpdir(), 'omni-mac-package-'));
  try {
    console.log(`==> ${names.zip}`);
    makeZip(app, join(out, names.zip));
    console.log(`==> ${names.dmg}`);
    makeDmg(app, join(out, names.dmg), work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log('==> Block maps and latest-mac.yml');
  const described = [names.zip, names.dmg].map((name) => {
    const file = describeFile(join(out, name));
    writeFileSync(join(out, `${name}.blockmap`), gzipSync(JSON.stringify(file.blockMap), { level: 9 }));
    return { name, sha512: file.sha512, size: file.size };
  });
  writeFileSync(join(out, names.feed), feedText(version, described[0], described[1], now));
  for (const name of names.all) console.log(`${String(statSync(join(out, name)).size).padStart(12)}  ${name}`);
  return names.all.map((name) => join(out, name));
}

if (import.meta.main) {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(`mac-release-package: ${parsed.error}`);
    process.exit(2);
  }
  try {
    packageMac(parsed);
  } catch (err) {
    console.error(`mac-release-package: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
