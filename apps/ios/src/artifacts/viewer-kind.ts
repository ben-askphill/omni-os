import { ARTIFACT_MAX_BYTES, type Artifact } from '@omni/client-core';

/** How the app shows a file. Each server kind maps to one, so a new server kind falls back to `file`. */
export type ViewerKind = 'page' | 'svg' | 'markdown' | 'image' | 'pdf' | 'table' | 'text' | 'file';

const VIEWERS: Record<string, ViewerKind> = {
  html: 'page',
  svg: 'svg',
  markdown: 'markdown',
  image: 'image',
  screenshot: 'image',
  pdf: 'pdf',
  csv: 'table',
  json: 'text',
  text: 'text',
};

export const viewerFor = (kind: string): ViewerKind => VIEWERS[kind] ?? 'file';

/** Past this the phone fetches nothing. The viewer says so instead of filling memory. */
export const tooLarge = (artifact: Pick<Artifact, 'size'>): boolean => artifact.size > ARTIFACT_MAX_BYTES;

/** Kinds the Library draws a picture for. The rest show stripes with their extension, as phone web does for files it cannot draw. */
export const hasThumbnail = (kind: string): boolean => viewerFor(kind) === 'image';

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : 'file';
}

/**
 * A cache file name from the row alone: the id and the version it was fetched at. A rewrite changes `updated_at`,
 * so it gets a new name and the old copy is never shown for it.
 */
export function cacheFileName(artifact: Pick<Artifact, 'id' | 'name' | 'updated_at'>): string {
  const version = artifact.updated_at.replace(/[^0-9a-z]/gi, '');
  const ext = extensionOf(artifact.name).replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
  return `${artifact.id}-${version}.${ext}`;
}

/** `shortAgo`'s answer as a phrase: "now" is "just now", "5m" is "5m ago", and a date is "on 12 Oct". */
export function agoPhrase(short: string): string {
  if (short === 'now') return 'just now';
  return /^\d+[mhd]$/.test(short) ? `${short} ago` : short ? `on ${short}` : '';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The longest text the viewer lays out at once. A larger file shows its start and says how to get the rest. */
export const TEXT_PREVIEW_LIMIT = 200_000;

export interface TextPreview {
  text: string;
  truncated: boolean;
}

export function textPreview(source: string, kind: string): TextPreview {
  let text = source;
  if (kind === 'json') {
    try {
      text = JSON.stringify(JSON.parse(source), null, 2);
    } catch {
      // Not valid JSON: show it as it is.
    }
  }
  return text.length > TEXT_PREVIEW_LIMIT ? { text: text.slice(0, TEXT_PREVIEW_LIMIT), truncated: true } : { text, truncated: false };
}
