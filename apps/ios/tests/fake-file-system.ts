/**
 * An in-memory stand-in for the parts of `expo-file-system` the artifact cache uses, for vitest's node environment.
 * Like the real one, a file cannot be made in a folder that does not exist, and deleting a folder deletes what is in it.
 */
const files = new Map<string, Uint8Array>();
const folders = new Set<string>();

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
    files.delete(this.uri);
  }
  write(bytes: Uint8Array): void {
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
}
