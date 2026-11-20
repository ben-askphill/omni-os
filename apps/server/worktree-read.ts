// The worktree read a remote agent gets where its channel allows it (group threads slice 5, ADR 0020, #903): list,
// read and search the thread's git-tracked files, and its diff and changed-file list. The tool travels through the
// remote harness protocol as a client-side call (harness/read-tool.ts), so the server never calls Omni and Omni opens
// no inbound endpoint (Q38).
//
// - The credential is a grant: a random token in this process's memory, keyed to the thread, the turn and the worktree
//   path, opened when a remote agent's turn starts and closed when it ends. A restart forgets every grant. It is never a
//   thread token, and it never leaves Omni: the adapter holds it and the server only ever sees the call's answer (Q39).
// - Every read checks the channel's switch again, so turning it off refuses the next read of a turn already running.
// - Git-tracked files only (Q40): untracked and ignored files read as absent, which also hides `.git/` and, where they
//   are untracked or ignored, `.env` files and the channel's copied and shared files. The diff follows the same rule (Q41).
// - Text only, up to 1 MB (Q66). No writes: git runs without optional locks, diff drivers or textconv.
import { randomBytes } from 'node:crypto';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { channels, threads, type Thread } from './db.ts';
import { changesCheckout, git, head, threadBase } from './changes.ts';
import { remoteSeesWork } from './remote-agents.ts';
import { userName } from './profile.ts';
import { READ_CAP, readArgs } from './harness/read-tool.ts';

/** Files one list names. */
const LIST_MAX = 2_000;
/** Lines one search returns. */
const SEARCH_MAX = 500;

interface Grant {
  /** The group thread whose worktree it reads: a member's own row reads its group's. */
  thread: string;
  turn: string;
  channel: string;
  /** The checkout when the turn started, or why there is none. */
  worktree: string | null;
  reason: string;
}

const grants = new Map<string, Grant>();

/** What a read answers: its text, or why it was refused. */
export interface ReadAnswer {
  ok: boolean;
  output: string;
}

const refuse = (why: string): ReadAnswer => ({ ok: false, output: `Refused: ${why}` });

/** The thread whose worktree a session reads: its group thread when it is a seated member's own row. */
const groupOf = (session: Thread): Thread => (session.source === 'member' && session.parent_id ? (threads.get(session.parent_id) ?? session) : session);

/** Whether Omni offers the read tool on this session's turn: its channel opens its work to remote agents. */
export function readOffered(session: Thread): boolean {
  return remoteSeesWork(session.channel_id);
}

/** Open the read for one turn of a remote agent's session. The token stays in Omni. */
export async function openRead(session: Thread, turn: string): Promise<string> {
  const group = groupOf(session);
  const at = await changesCheckout(group).catch((e: unknown) => ({ reason: e instanceof Error ? e.message : String(e) }));
  const token = `omr_${randomBytes(32).toString('base64url')}`;
  grants.set(token, { thread: group.id, turn, channel: group.channel_id, worktree: 'dir' in at ? at.dir : null, reason: 'reason' in at ? at.reason : '' });
  return token;
}

/** Close a turn's read: a call that names it from now on is refused. */
export function closeRead(token: string | null | undefined): void {
  if (token) grants.delete(token);
}

const ENDED = 'the turn that asked for this read has ended, so its read is closed. Ask again in a new turn.';

/** Answer one call of the read tool with the grant `token` names. Never throws. */
export async function answerRead(token: string | null | undefined, raw: unknown): Promise<ReadAnswer> {
  const grant = token ? grants.get(token) : undefined;
  if (!grant) return refuse(ENDED);
  const ch = channels.get(grant.channel);
  if (!remoteSeesWork(grant.channel)) {
    return refuse(`#${ch?.name ?? grant.channel} keeps its work from remote agents. ${userName()} can open it in Channel settings with "Remote agents can see this channel's work".`);
  }
  if (!grant.worktree) return refuse(grant.reason || 'this thread has no worktree on this machine.');
  const group = threads.get(grant.thread);
  const now = group ? await changesCheckout(group).catch(() => null) : null;
  if (!now || !('dir' in now) || now.dir !== grant.worktree) return refuse("the thread's worktree is not where it was when this turn started.");
  const args = readArgs(raw);
  if (!args) return refuse('the call came without arguments Omni could read.');
  const root = grant.worktree;
  try {
    switch (args.action) {
      case 'read':
        return await readFile(root, args.path);
      case 'list':
        return await listFiles(root, args.path);
      case 'search':
        return await search(root, args.pattern, args.path);
      case 'diff':
        return await diff(group!, root);
      default:
        return refuse(`there is no "${args.action}" action: use list, read, search or diff.`);
    }
  } catch (e) {
    const status = (e as { code?: unknown }).code;
    return refuse(status === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'the answer was too large.' : 'git could not answer it in this worktree.');
  }
}

// ---------- paths ----------

/** A path inside the worktree, lexically: relative, POSIX, without `.` or `..`. '' is the root. */
function relPath(path: string | undefined): { rel: string } | { refused: string } {
  const p = (path ?? '').trim().replace(/\\/g, '/');
  if (p.includes('\0')) return { refused: 'that path is not a valid file name.' };
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.startsWith('~')) return { refused: `${p} is outside the thread's worktree: give a path relative to its root.` };
  const norm = posix.normalize(p || '.').replace(/\/+$/, '');
  if (norm === '..' || norm.startsWith('../')) return { refused: `${p} is outside the thread's worktree.` };
  return { rel: norm === '.' ? '' : norm };
}

/** git for reading, with nothing that could write, prompt or run a repo's own program. */
const readGit = (root: string, args: string[], max = READ_CAP * 4) => git(root, ['-c', 'core.fsmonitor=false', ...args], max);

/** The tracked files at or under `rel`: the file itself, or a folder's files. */
async function tracked(root: string, rel: string): Promise<string[]> {
  const out = await readGit(root, ['ls-files', '-z', '--', rel ? `:(literal)${rel}` : '.'], 64 * 1024 * 1024);
  return out.split('\0').filter(Boolean);
}

/** Whether `full` resolves inside `root`, following every symlink on the way. */
function resolvesInside(root: string, full: string): string | null {
  let top: string;
  let real: string;
  try {
    top = realpathSync(root);
    real = realpathSync(full);
  } catch {
    return null;
  }
  return real === top || real.startsWith(top + sep) ? relative(top, real).split(sep).join('/') : null;
}

const hidden = (rel: string) => `there is no git-tracked file at ${rel}. The read tool sees only files git tracks: untracked and ignored files are hidden.`;

const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** Text cut to the cap on a character boundary, with a note when it was. */
function capped(text: string, what: string): string {
  const bytes = Buffer.byteLength(text);
  if (bytes <= READ_CAP) return text;
  const cut = Buffer.from(text).subarray(0, READ_CAP).toString('utf8').replace(/�$/, '');
  return `${cut}\n\n[Cut to 1 MB of ${mb(bytes)}: the rest of ${what} was left out.]`;
}

// ---------- the actions ----------

async function readFile(root: string, path: string | undefined): Promise<ReadAnswer> {
  if (!path?.trim()) return refuse('read needs a path.');
  const p = relPath(path);
  if ('refused' in p) return refuse(p.refused);
  if (!p.rel) return refuse('that is the worktree itself: list it instead.');
  const files = await tracked(root, p.rel);
  if (!files.includes(p.rel)) return files.length ? refuse(`${p.rel} is a folder: list it instead.`) : refuse(hidden(p.rel));
  const full = join(root, p.rel);
  let st;
  try {
    st = lstatSync(full);
  } catch {
    return refuse(`${p.rel} is tracked but not in the worktree: it was deleted there.`);
  }
  // A symlink, in the path or the file itself, is followed only to a tracked file inside the worktree.
  const real = resolvesInside(root, full);
  if (real === null) return refuse(`${p.rel} leads out of the thread's worktree, so it is not read.`);
  if (st.isSymbolicLink() && !(await tracked(root, real)).includes(real)) return refuse(`${p.rel} leads to a file git does not track.`);
  if (!statSync(full).isFile()) return refuse(`${p.rel} is not a file.`);
  const size = statSync(full).size;
  const buf = head(full, READ_CAP);
  if (buf.subarray(0, 8000).includes(0)) return refuse(`${p.rel} is a binary file. The read tool returns text only.`);
  const text = buf.toString('utf8').replace(/�$/, '');
  return { ok: true, output: size > READ_CAP ? `${text}\n\n[Cut to 1 MB of ${mb(size)}: the rest of ${p.rel} was left out.]` : text };
}

async function listFiles(root: string, path: string | undefined): Promise<ReadAnswer> {
  const p = relPath(path);
  if ('refused' in p) return refuse(p.refused);
  const files = await tracked(root, p.rel);
  if (!files.length) return { ok: true, output: p.rel ? `No git-tracked files at ${p.rel}.` : 'No git-tracked files.' };
  const shown = files.slice(0, LIST_MAX).join('\n');
  return { ok: true, output: capped(files.length > LIST_MAX ? `${shown}\n\n[${files.length - LIST_MAX} more tracked files left out: list a folder.]` : shown, 'the list') };
}

async function search(root: string, pattern: string | undefined, path: string | undefined): Promise<ReadAnswer> {
  if (!pattern) return refuse('search needs a pattern.');
  const p = relPath(path);
  if ('refused' in p) return refuse(p.refused);
  let out: string;
  try {
    // Tracked files only (git grep's default), text only (-I), never a symlink's target.
    out = await readGit(root, ['grep', '-n', '-I', '-E', '--no-color', '-e', pattern, '--', p.rel ? `:(literal)${p.rel}` : '.']);
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (code === 1) return { ok: true, output: `No tracked line matches ${pattern}.` };
    if (code === 128) return refuse(`${pattern} is not an extended regular expression git can read.`);
    throw e;
  }
  const lines = out.split('\n').filter(Boolean);
  const shown = lines.slice(0, SEARCH_MAX).join('\n');
  return { ok: true, output: capped(lines.length > SEARCH_MAX ? `${shown}\n\n[${lines.length - SEARCH_MAX} more matching lines left out: narrow the pattern or the path.]` : shown, 'the matches') };
}

const STATUS: Record<string, string> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed', U: 'unmerged' };

async function diff(group: Thread, root: string): Promise<ReadAnswer> {
  const base = await threadBase(group.id, root);
  // The worktree against the thread's base, as Changes compares it, for tracked files only: a new file shows once it
  // is staged or committed (Q41).
  const common = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames', base.sha];
  const names = (await readGit(root, [...common.slice(0, 1), '-z', '--name-status', ...common.slice(1)])).split('\0').filter(Boolean);
  const listed: string[] = [];
  for (let i = 0; i < names.length; ) {
    const code = names[i++];
    const kind = STATUS[code[0]] ?? code;
    const path = names[i++];
    if (code[0] === 'R' || code[0] === 'C') listed.push(`${kind}: ${path} -> ${names[i++]}`);
    else listed.push(`${kind}: ${path}`);
  }
  if (!listed.length) return { ok: true, output: `No changes to tracked files since the thread's base (${base.sha.slice(0, 10)}).` };
  const patch = await readGit(root, common, 64 * 1024 * 1024);
  return { ok: true, output: capped(`Changed files since the thread's base (${base.sha.slice(0, 10)}):\n${listed.join('\n')}\n\n${patch}`, 'the diff') };
}
