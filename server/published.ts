// Pages a thread published to claude.ai with its Artifact tool, linked to the thread's artifacts.
// The publish names a local file. One in the thread's artifacts folder gets the URL on its row; one anywhere
// else (a scratchpad, a repo) is copied in first, so the thread keeps the version it published.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { publishedFrom, type Published } from '../shared/published.ts';
import { classify } from './artifacts.ts';
import { publishFeed, publishThread } from './bus.ts';
import { artifactsDir, paths } from './config.ts';
import { artifacts, events, kv, threads, type Artifact } from './db.ts';

const BACKFILL_KEY = 'published.backfilled';

const inside = (dir: string, p: string) => {
  const rel = relative(dir, p);
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel);
};

/** Where the published file lives in the thread's artifacts folder: where it already is, or a free name for its copy. */
function target(threadId: string, src: string, url: string): string {
  const dir = artifactsDir(threadId);
  if (inside(dir, src)) return src;
  // A republish overwrites the copy an earlier publish of the same page made.
  const prior = artifacts.byThread(threadId).find((a) => a.url === url && inside(dir, a.path));
  if (prior) return prior.path;
  const ext = extname(src);
  const stem = basename(src, ext);
  for (let n = 1; ; n++) {
    const p = join(dir, n === 1 ? `${stem}${ext}` : `${stem}-${n}${ext}`);
    if (!existsSync(p)) return p;
  }
}

/** Record one publish. Returns the artifact row it linked, or null when there is no local file to link. */
export function linkPublished(threadId: string, p: Published): Artifact | null {
  const thread = threads.get(threadId);
  if (!thread || !p.file_path) return null;
  const src = isAbsolute(p.file_path) ? p.file_path : resolve(thread.cwd, p.file_path);
  if (!existsSync(src) || !statSync(src).isFile()) return null;
  const dest = target(threadId, src, p.url);
  const c = classify(relative(paths.threads, dest));
  if (!c || c.kind === 'screenshot') return null;
  if (dest !== src) {
    mkdirSync(artifactsDir(threadId), { recursive: true });
    copyFileSync(src, dest);
  }
  const row = artifacts.upsert({ thread_id: threadId, path: dest, name: basename(dest), kind: c.kind, size: statSync(dest).size });
  const linked = artifacts.setPublished(row.id, p.url, p.description ?? null) ?? row;
  publishThread(threadId, { kind: 'artifact', artifact: linked });
  publishFeed({ type: 'artifact', artifact: linked });
  return linked;
}

/** A tool result came in: if it finished an Artifact publish, link the page. Never throws into the stream. */
export function onToolResult(threadId: string, r: { tool_use_id: string; text: string; is_error: boolean }) {
  if (r.is_error || !r.text.includes('claude.ai/')) return;
  try {
    const use = events.toolUse(threadId, r.tool_use_id);
    const p = use && publishedFrom(use.name, use.input, r);
    if (p) linkPublished(threadId, p);
  } catch (err) {
    console.error('[published] could not link a publish:', (err as Error).message);
  }
}

/** Once per database: link what threads published before Omni tracked it. Files that are gone stay unlinked. */
export function backfillPublished() {
  if (kv.get(BACKFILL_KEY)) return;
  let linked = 0;
  for (const row of events.artifactCalls()) {
    try {
      const use = JSON.parse(row.use) as { name: string; input: unknown };
      const p = publishedFrom(use.name, use.input, JSON.parse(row.result));
      if (p && linkPublished(row.thread_id, p)) linked++;
    } catch (err) {
      console.error('[published] backfill skipped a publish:', (err as Error).message);
    }
  }
  kv.set(BACKFILL_KEY, true);
  if (linked) console.log(`[published] linked ${linked} earlier publish(es)`);
}
