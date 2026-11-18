/**
 * An in-memory stand-in for the parts of `expo-file-system` the artifact cache uses, for vitest's node environment.
 * Like the real one, a file cannot be made in a folder that does not exist, deleting a folder deletes what is in it,
 * and deleting a file that is not there throws.
 */
interface Disk {
  files: Map<string, Uint8Array>;
  folders: Set<string>;
  /** While set, a folder delete throws, as a cache that will not clear does. */
  deletesFail: boolean;
  /** While set, a write waits for it before it lands. */
  writeGate: Promise<void> | null;
  writesStarted: number;
}

// On globalThis, so a test that loads the cache module again (a new launch of the app) still sees the same disk.
const disk: Disk = ((globalThis as { omniFakeDisk?: Disk }).omniFakeDisk ??= {
  files: new Map(),
  folders: new Set(),
  deletesFail: false,
  writeGate: null,
  writesStarted: 0,
});
const { files, folders } = disk;

type Part = string | Directory | File;

const joined = (parts: Part[]) =>
  parts
    .map((p) => (typeof p === 'string' ? p : p.uri))
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^file:\//, 'file:///')
    .replace(/\/$/, '');

const parentOf = (uri: string) => uri.slice(0, uri.lastIndexOf('/'));

export class Directory {
  readonly uri: string;
  constructor(...parts: Part[]) {
    this.uri = joined(parts);
  }
  get exists(): boolean {
    return folders.has(this.uri);
  }
  create(options: { idempotent?: boolean; intermediates?: boolean } = {}): void {
    if (this.exists) {
      if (options.idempotent) return;
      throw new Error(`${this.uri} exists`);
    }
    if (!folders.has(parentOf(this.uri))) {
      if (!options.intermediates) throw new Error(`no folder ${parentOf(this.uri)}`);
      new Directory(parentOf(this.uri)).create({ idempotent: true, intermediates: true });
    }
    folders.add(this.uri);
  }
  delete(): void {
    if (disk.deletesFail) throw new Error(`could not delete ${this.uri}`);
    for (const f of [...files.keys()]) if (f.startsWith(`${this.uri}/`)) files.delete(f);
    for (const d of [...folders]) if (d === this.uri || d.startsWith(`${this.uri}/`)) folders.delete(d);
  }
}

export class File {
  readonly uri: string;
  constructor(...parts: Part[]) {
    this.uri = joined(parts);
  }
  get exists(): boolean {
    return files.has(this.uri);
  }
  get size(): number {
    return files.get(this.uri)?.length ?? 0;
  }
  create(_options: { overwrite?: boolean } = {}): void {
    if (!folders.has(parentOf(this.uri))) throw new Error(`no folder ${parentOf(this.uri)}`);
    files.set(this.uri, new Uint8Array());
  }
  delete(): void {
    if (!files.has(this.uri)) throw new Error(`no file ${this.uri}`);
    files.delete(this.uri);
  }
  async write(bytes: Uint8Array): Promise<void> {
    disk.writesStarted += 1;
    if (disk.writeGate) await disk.writeGate;
    if (!folders.has(parentOf(this.uri))) throw new Error(`no folder ${parentOf(this.uri)}`);
    files.set(this.uri, bytes);
  }
  copy(to: File, _options: { overwrite?: boolean } = {}): void {
    const bytes = files.get(this.uri);
    if (!bytes) throw new Error(`no file ${this.uri}`);
    if (!folders.has(parentOf(to.uri))) throw new Error(`no folder ${parentOf(to.uri)}`);
    files.set(to.uri, bytes);
  }
  textSync(): string {
    return new TextDecoder().decode(files.get(this.uri));
  }
}

export const Paths = { cache: new Directory('file:///cache') };

/** Everything written so far, as text, to look for bytes that should not be there. */
export const writtenTexts = (): string[] => [...files.values()].map((b) => new TextDecoder().decode(b));

/** A fresh disk with only the cache folder. */
export function resetDisk(): void {
  files.clear();
  folders.clear();
  folders.add(Paths.cache.uri);
  disk.deletesFail = false;
  disk.writeGate = null;
  disk.writesStarted = 0;
}

/** Puts `text` at `uri`, as a file an earlier launch of the app left there. */
export function leaveFile(uri: string, text: string): void {
  for (let d = uri.slice(0, uri.lastIndexOf('/')); d.length > 'file://'.length; d = d.slice(0, d.lastIndexOf('/'))) folders.add(d);
  files.set(uri, new TextEncoder().encode(text));
}

export function failDeletes(fail: boolean): void {
  disk.deletesFail = fail;
}

/** Holds every write until the returned function runs. */
export function holdWrites(): () => void {
  let release = () => {};
  disk.writeGate = new Promise<void>((resolve) => {
    release = () => {
      disk.writeGate = null;
      resolve();
    };
  });
  return release;
}

export const writesSoFar = () => disk.writesStarted;
