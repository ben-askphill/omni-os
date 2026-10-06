// The `@` menu's files, and what a sent message's `@path` tokens point at. Two places: this thread's
// artifacts (named `@artifacts/<name>`), and the repo the thread works in (named by relative path).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { artifacts } from './db.ts';
import { mentionTokens, type FileMention } from '../shared/mention-menu.ts';

const MAX_FILES = 20_000;
const MAX_ROWS = 30;
const CACHE_MS = 10_000;
const SKIP = new Set(['node_modules', '.git', 'data', 'dist', 'build', '.next', '.cache']);

const cache = new Map<string, { at: number; files: string[] }>();

/** Every file under `cwd`, as relative paths: what git tracks or doesn't ignore, else a bounded walk. */
export function repoFiles(cwd: string): string[] {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.files;
  let files: string[];
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    files = out.toString().split('\0').filter(Boolean);
  } catch {
    files = walk(cwd);
  }
  files = files.slice(0, MAX_FILES);
  cache.set(cwd, { at: Date.now(), files });
  return files;
}

function walk(root: string): string[] {
  const out: string[] = [];
  const todo = [''];
  while (todo.length && out.length < MAX_FILES) {
    const rel = todo.shift()!;
    let entries;
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) todo.push(p);
      else if (e.isFile()) out.push(p);
    }
  }
  return out;
}

/** How well a path matches the search, 0 best. Null when it doesn't match. */
function rank(path: string, q: string): number | null {
  const p = path.toLowerCase();
  const name = basename(p);
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  if (p.includes(q)) return 3;
  return null;
}

const dirOf = (p: string) => (dirname(p) === '.' ? 'repo root' : dirname(p));

/** What the menu lists for `query`: this thread's artifacts first, then the repo's files. */
export function listMentions(opts: { cwd: string | null; threadId?: string; query: string }): FileMention[] {
  const q = opts.query.toLowerCase();
  const pick = <T>(rows: T[], path: (r: T) => string, limit: number) =>
    rows
      .flatMap((r) => {
        const k = q ? rank(path(r), q) : 0;
        return k === null ? [] : [{ r, k }];
      })
      .sort((a, b) => a.k - b.k || path(a.r).length - path(b.r).length || path(a.r).localeCompare(path(b.r)))
      .slice(0, limit)
      .map((h) => h.r);

  const mine = opts.threadId ? artifacts.byThread(opts.threadId).filter((a) => a.kind !== 'screenshot') : [];
  const fromThread: FileMention[] = pick(mine, (a) => a.name, MAX_ROWS).map((a) => ({
    insert: `artifacts/${a.name}`,
    name: a.name,
    detail: 'artifact in this thread',
    kind: 'artifact',
  }));
  const fromRepo: FileMention[] =
    opts.cwd && existsSync(opts.cwd)
      ? pick(repoFiles(opts.cwd), (p) => p, MAX_ROWS - fromThread.length).map((p) => ({ insert: p, name: basename(p), detail: dirOf(p), kind: 'file' }))
      : [];
  return [...fromThread, ...fromRepo].slice(0, MAX_ROWS);
}

export interface Mentioned {
  token: string;
  path: string;
  kind: 'artifact' | 'file' | 'folder';
}

/** The `@path` tokens in `text` that name a file this thread can reach. Anything else stays plain text. */
export function resolveMentions(text: string, opts: { cwd: string | null; threadId?: string }): Mentioned[] {
  const tokens = mentionTokens(text);
  if (!tokens.length) return [];
  const mine = opts.threadId ? artifacts.byThread(opts.threadId) : [];
  const out: Mentioned[] = [];
  for (const token of tokens) {
    const art = token.startsWith('artifacts/') ? mine.find((a) => a.name === token.slice('artifacts/'.length) && existsSync(a.path)) : undefined;
    if (art) {
      out.push({ token, path: art.path, kind: 'artifact' });
      continue;
    }
    if (!opts.cwd || isAbsolute(token)) continue;
    const full = resolve(opts.cwd, token);
    // A path out of the repo is not a mention.
    const rel = relative(opts.cwd, full);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !existsSync(full)) continue;
    out.push({ token, path: full, kind: statSync(full).isDirectory() ? 'folder' : 'file' });
  }
  return out;
}

/** Appended to the prompt so the agent knows which file each `@name` meant, and where it is. */
export function describeMentions(found: Mentioned[]): string {
  const lines = [
    '## Mentioned files',
    'Ben referred to these with @ in the message above. Read them with Read or cat.',
    ...found.map((m) => `- @${m.token} (${m.kind === 'artifact' ? 'artifact in this thread' : m.kind}): ${m.path}`),
  ];
  return lines.join('\n');
}

/** `text` with the files its `@` tokens name described after it, or as it is when none resolve. */
export function withMentions(text: string, opts: { cwd: string | null; threadId?: string }): string {
  const found = resolveMentions(text, opts);
  return found.length ? `${text}\n\n${describeMentions(found)}` : text;
}
