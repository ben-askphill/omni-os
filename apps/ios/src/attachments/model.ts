import type { UploadFile } from '@omni/client-core';

/** Where a staged file came from. */
export type Source = 'library' | 'camera' | 'files';

/** A file chosen for the next message. It stays where the picker left it until the request reads it. */
export interface Staged {
  /** Unique within the list, so two files with one name can be told apart and removed one at a time. */
  id: string;
  uri: string;
  name: string;
  /** A MIME type. Never empty: the server files an unknown one as `application/octet-stream`. */
  type: string;
  /** Bytes, or null when the picker did not say. The server still checks. */
  size: number | null;
  image: boolean;
  source: Source;
}

/** At most this many files go with one message, as on the web composer. */
export const MAX_ATTACHMENTS = 10;
/** The server's default cap per file. `GET /status` says the real one. */
export const DEFAULT_MAX_MB = 25;

const MB = 1024 * 1024;

const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
};

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

const extensionOf = (name: string): string => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '');

/** The last path segment of a file URI, decoded. Empty when there is none. */
export function baseName(uri: string): string {
  const last = uri.split(/[?#]/)[0]?.split('/').pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** A type for a file whose picker gave none or a generic one. Unknown extensions fall back to a binary file. */
export function typeFor(name: string, given?: string | null): string {
  const type = given?.trim().toLowerCase();
  if (type && type !== 'application/octet-stream') return type;
  return TYPE_BY_EXTENSION[extensionOf(name)] ?? 'application/octet-stream';
}

/**
 * The name a file goes under. The server files a name's extension as its kind, so a picker name without one (a photo
 * from the library often has none) gets the extension its type implies.
 */
export function nameFor(given: string | null | undefined, uri: string, type: string, fallback: string): string {
  let name = (given?.trim() || baseName(uri) || fallback).replace(/[\\/]/g, '-');
  if (!extensionOf(name)) {
    const ext = EXTENSION_BY_TYPE[type];
    if (ext) name = `${name}.${ext}`;
  }
  return name;
}

interface ImageAsset {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}

interface DocumentAsset {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
}

/** What `expo-image-picker` returns for the library or the camera. */
export function fromImageAsset(asset: ImageAsset, id: string, source: 'library' | 'camera', now: number): Staged {
  const fallback = `${source === 'camera' ? 'Camera' : 'Photo'}-${now}.jpg`;
  const type = typeFor(asset.fileName ?? baseName(asset.uri), asset.mimeType ?? 'image/jpeg');
  const name = nameFor(asset.fileName, asset.uri, type, fallback);
  return { id, uri: asset.uri, name, type, size: asset.fileSize ?? null, image: type.startsWith('image/'), source };
}

/** What `expo-document-picker` returns. */
export function fromDocumentAsset(asset: DocumentAsset, id: string): Staged {
  const type = typeFor(asset.name, asset.mimeType);
  return { id, uri: asset.uri, name: nameFor(asset.name, asset.uri, type, 'file'), type, size: asset.size ?? null, image: type.startsWith('image/'), source: 'files' };
}

export type Problem =
  | { kind: 'too-large'; name: string }
  | { kind: 'empty'; name: string }
  | { kind: 'too-many'; count: number };

export interface Staging {
  list: readonly Staged[];
  problems: readonly Problem[];
}

/**
 * Adds files to the list. A file the server would refuse (empty, over the cap) is left out and named in `problems`,
 * so Ben hears about it before the message is written. A file already in the list (same URI) is skipped quietly.
 */
export function stage(current: readonly Staged[], incoming: readonly Staged[], maxMb: number): Staging {
  const list = [...current];
  const problems: Problem[] = [];
  let dropped = 0;
  for (const file of incoming) {
    if (list.some((f) => f.uri === file.uri)) continue;
    if (file.size === 0) problems.push({ kind: 'empty', name: file.name });
    else if (file.size !== null && file.size > maxMb * MB) problems.push({ kind: 'too-large', name: file.name });
    else if (list.length >= MAX_ATTACHMENTS) dropped++;
    else list.push(file);
  }
  if (dropped) problems.push({ kind: 'too-many', count: dropped });
  return { list, problems };
}

const quoted = (names: readonly string[]) => names.map((n) => `"${n}"`).join(', ');

/** One sentence for what `stage` left out. Null when it left nothing out. */
export function describeProblems(problems: readonly Problem[], maxMb: number): string | null {
  const parts: string[] = [];
  const big = problems.filter((p) => p.kind === 'too-large').map((p) => p.name);
  if (big.length) parts.push(`${quoted(big)} ${big.length > 1 ? 'are' : 'is'} over the ${maxMb} MB limit.`);
  const empty = problems.filter((p) => p.kind === 'empty').map((p) => p.name);
  if (empty.length) parts.push(`${quoted(empty)} ${empty.length > 1 ? 'are' : 'is'} empty.`);
  if (problems.some((p) => p.kind === 'too-many')) parts.push(`At most ${MAX_ATTACHMENTS} files per message.`);
  return parts.length ? parts.join(' ') : null;
}

export const removeStaged = (list: readonly Staged[], id: string): Staged[] => list.filter((f) => f.id !== id);

/** What the request reads. */
export const toUploadFiles = (list: readonly Staged[]): UploadFile[] => list.map((f) => ({ uri: f.uri, name: f.name, type: f.type }));

/** Identifies a set of files for a send: the same files again is the same send, so a retry keeps its request id. */
export const filesKey = (list: readonly Staged[]): string => list.map((f) => `${f.uri}:${f.size ?? ''}`).join('|');

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** 1.2 MB, 340 KB. One decimal from megabytes up. */
export function formatBytes(n: number): string {
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit >= 2 ? value.toFixed(1) : Math.round(value)} ${SIZE_UNITS[unit]}`;
}
