import { watch, statSync, existsSync } from 'node:fs';
import { join, sep, extname, basename } from 'node:path';
import { paths } from './config.ts';
import { artifacts, threads } from './db.ts';
import { publishFeed, publishThread } from './bus.ts';

const KINDS: Record<string, string> = {
  '.html': 'html', '.htm': 'html', '.md': 'markdown', '.svg': 'svg', '.png': 'image', '.jpg': 'image',
  '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.pdf': 'pdf', '.csv': 'csv', '.json': 'json', '.txt': 'text',
};

export const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', markdown: 'text/markdown; charset=utf-8', svg: 'image/svg+xml',
  pdf: 'application/pdf', csv: 'text/csv; charset=utf-8', json: 'application/json', text: 'text/plain; charset=utf-8',
};

export function mimeFor(path: string, kind: string) {
  if (kind === 'image' || kind === 'screenshot') {
    const ext = extname(path).slice(1).toLowerCase();
    return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  }
  return MIME[kind] ?? 'application/octet-stream';
}

/** Maps "<threadId>/artifacts/x.html" or "<threadId>/browser/x.png" to an artifact record. */
export function classify(rel: string): { threadId: string; kind: string } | null {
  const parts = rel.split(sep);
  if (parts.length < 3) return null;
  const [threadId, area] = parts;
  const kind = KINDS[extname(rel).toLowerCase()];
  if (!kind || basename(rel).startsWith('.')) return null;
  if (area === 'artifacts') return { threadId, kind };
  if (area === 'browser' && kind === 'image') return { threadId, kind: 'screenshot' };
  return null;
}

const timers = new Map<string, NodeJS.Timeout>();

function register(rel: string) {
  const c = classify(rel);
  if (!c || !threads.get(c.threadId)) return;
  const full = join(paths.threads, rel);
  if (!existsSync(full)) {
    artifacts.remove(full);
    return;
  }
  const st = statSync(full);
  if (!st.isFile()) return;
  const row = artifacts.upsert({ thread_id: c.threadId, path: full, name: basename(full), kind: c.kind, size: st.size });
  publishThread(c.threadId, { kind: 'artifact', artifact: row });
  publishFeed({ type: 'artifact', artifact: row });
}

export function startArtifactWatcher() {
  watch(paths.threads, { recursive: true }, (_evt, filename) => {
    if (!filename) return;
    const rel = filename.toString();
    clearTimeout(timers.get(rel));
    // Agents often write in several chunks; wait for the file to settle.
    timers.set(rel, setTimeout(() => (timers.delete(rel), register(rel)), 400));
  });
}
