// Haiku sidecars: a title for a new thread, and after a turn a suggested reply, a proposed follow-up thread and what the
// turn left open for Ben.
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { closePipesAfterExit } from '../child.ts';
import { config, paths } from '../config.ts';
import { events, threads, type Thread } from '../db.ts';
import { harnessEnv } from '../harness/env-guard.ts';
import { parseOpenItems, storeOpenItems } from '@omni/shared/open-items.ts';
import { userName, userPossessive } from '../profile.ts';
import { emitThread } from './state.ts';

/** Each thread's latest suggestion calls. A message sent while one runs makes its answer stale. */
const suggestCalls = new Map<string, number>();
const nextCalls = new Map<string, number>();
const openCalls = new Map<string, number>();
let suggestSeq = 0;

/**
 * A call's working directory: a fresh 0700 folder of its own inside a 0700 folder in Omni's data dir, so the CLI's
 * project settings can only be ones Omni put there (none). A shared temp dir could hold a planted
 * `.claude/settings.json` with hooks. The caller removes it once the call ends.
 */
export function auxRunDir(dir = paths.data): string {
  const root = join(dir, 'aux-run');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  return mkdtempSync(join(root, 'call-'));
}

function removeRunDir(cwd: string) {
  try {
    rmSync(cwd, { recursive: true, force: true });
  } catch {
    return;
  }
}

/** The model and effort of a one-shot call: Haiku at its default effort unless the caller names others. */
interface OneShotRun {
  model: string;
  effort?: string;
}

/**
 * One Claude call with no tools and no session, on Haiku unless `run` names another model. `done` gets its trimmed
 * output once, or null when it failed, timed out or could not start (without a private folder the call is skipped:
 * titles keep their placeholder, no suggestion).
 */
function haiku(entrypoint: string, prompt: string, done: (out: string | null) => void, timeoutMs = 45_000, run: OneShotRun = { model: 'haiku' }) {
  let settled = false;
  const finish = (out: string | null) => {
    if (settled) return;
    settled = true;
    // Nobody waits on these calls: a shutdown may have closed the db by the time one ends.
    try {
      done(out);
    } catch {
      return;
    }
  };
  let cwd: string;
  try {
    cwd = auxRunDir();
  } catch {
    return finish(null);
  }
  let child;
  try {
    child = spawn(
      config.claudeBin,
      ['-p', '--model', run.model, ...(run.effort ? ['--effort', run.effort] : []), '--output-format', 'text', '--strict-mcp-config', '--no-session-persistence', '--tools', ''],
      { cwd, env: harnessEnv('claude-code', { CLAUDE_CODE_ENTRYPOINT: entrypoint }), stdio: ['pipe', 'pipe', 'ignore'] },
    );
  } catch (err) {
    removeRunDir(cwd);
    throw err;
  }
  closePipesAfterExit(child);
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  let out = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  child.stdout.on('data', (d) => (out += d));
  child.on('close', (code) => {
    clearTimeout(timer);
    removeRunDir(cwd);
    finish(code === 0 ? out.trim() : null);
  });
  child.on('error', () => {
    clearTimeout(timer);
    removeRunDir(cwd);
    finish(null);
  });
}

/**
 * One no-tools call as a promise: its trimmed output, or null when it failed or ran past `timeoutMs`. For the
 * merge-risk gate (merge-risk/gate.ts), which names its own model and effort.
 */
export function askClaude(entrypoint: string, prompt: string, timeoutMs: number, run: OneShotRun): Promise<string | null> {
  return new Promise((resolve, reject) => {
    try {
      haiku(entrypoint, prompt, resolve, timeoutMs, run);
    } catch (err) {
      reject(err);
    }
  });
}

/** One Haiku call as a promise: its trimmed output, or null when it failed or ran past `timeoutMs`. For the usage scan's labels. */
export const askHaiku = (entrypoint: string, prompt: string, timeoutMs: number) => askClaude(entrypoint, prompt, timeoutMs, { model: 'haiku' });

/** Drop the thread's suggested reply, proposed follow-up thread and open items, and any answer still on its way. */
export function clearSuggestion(threadId: string) {
  suggestCalls.delete(threadId);
  nextCalls.delete(threadId);
  openCalls.delete(threadId);
  const a = threads.setSuggestion(threadId, null);
  const b = threads.setNextThread(threadId, null);
  const c = threads.setOpenItems(threadId, null);
  if (a || b || c) emitThread(threadId);
}

/** Guess Ben's next reply from his last message and the agent's answer, for the reply box to offer. */
export function suggestReply(threadId: string, runText: string) {
  if (!config.suggestions) return;
  const call = ++suggestSeq;
  suggestCalls.set(threadId, call);
  const prompt =
    `${userName()} is working with a coding agent. Predict the short reply ${userName()} is most likely to send next, in their voice: ` +
    'a direct instruction or answer of at most 12 words, e.g. "Yes, open a PR" or "Run the tests first". ' +
    'Plain text, no quotes, no em dashes. If there is no obvious next step, output NONE. Output the reply only.\n\n' +
    `${userPossessive()} last message:\n` + events.lastUserText(threadId).slice(0, 1500) +
    "\n\nThe agent's answer:\n" + runText.slice(-3000);
  haiku('omni-os-suggest', prompt, (out) => {
    if (suggestCalls.get(threadId) !== call) return;
    suggestCalls.delete(threadId);
    const text = out?.split('\n').filter(Boolean).pop()?.replace(/^["']|["']$/g, '').trim().slice(0, 200);
    if (!text || /^none\.?$/i.test(text)) return;
    if (threads.get(threadId)?.status !== 'done') return;
    if (threads.setSuggestion(threadId, text)) emitThread(threadId);
  });
}

export const NEXT_PROMPT_MAX = 1200;

/** The title and prompt in Haiku's answer to `suggestNextThread`, or null for NONE or anything else. */
export function parseNextThread(out: string): { title: string; prompt: string } | null {
  const m = /^\s*TITLE:\s*(.+?)\s*\n+\s*PROMPT:\s*([\s\S]+?)\s*$/i.exec(out.replace(/\r/g, ''));
  if (!m) return null;
  const unquote = (s: string) => s.replace(/^["'`]+|["'`]+$/g, '').trim();
  const title = unquote(m[1]).replace(/\.$/, '').slice(0, 90);
  // Short enough for the card to show all of it: Start runs it with no other review, and Haiku wrote it from the
  // agent's answer, which can quote web pages and files.
  const prompt = unquote(m[2]);
  if (prompt.length > NEXT_PROMPT_MAX) return null;
  return title && prompt ? { title, prompt } : null;
}

/**
 * When the agent's answer leaves separate work for later, propose it as a new thread: a card under the
 * transcript that starts it with one click. Most turns propose nothing.
 */
export function suggestNextThread(threadId: string, runText: string) {
  if (!config.suggestions) return;
  const call = ++suggestSeq;
  nextCalls.set(threadId, call);
  const t = threads.get(threadId);
  const prompt =
    `${userName()} is working with a coding agent. Read the agent's answer below. If it clearly leaves follow-up work that is separate ` +
    `from this task and would run best as its own new thread (work it deferred or left for ${userName()} to decide, a next phase, ` +
    'a problem it found but did not fix), write a task card for that new thread. Otherwise output NONE. Most answers ' +
    'get NONE: never propose one for answering a question, approving, running tests, opening a PR or carrying on the same task.\n\n' +
    'Answer in exactly this format, plain text, no quotes, no em dashes:\n' +
    'TITLE: <the new thread\'s title, at most 8 words>\n' +
    `PROMPT: <its first message, written as ${userName()} would ask: 1 to 4 sentences, self-contained since the new thread cannot ` +
    'see this one, naming the repo, files, findings and constraints it needs>\n\n' +
    'Thread: ' + (t?.title ?? '') +
    `\n\n${userPossessive()} last message:\n` + events.lastUserText(threadId).slice(0, 1500) +
    "\n\nThe agent's answer:\n" + runText.slice(-4000);
  haiku('omni-os-next-thread', prompt, (out) => {
    if (nextCalls.get(threadId) !== call) return;
    nextCalls.delete(threadId);
    const next = out ? parseNextThread(out) : null;
    if (!next || threads.get(threadId)?.status !== 'done') return;
    if (threads.setNextThread(threadId, next)) emitThread(threadId);
  });
}

/**
 * What the agent's answer leaves for Ben to resolve before the thread can be closed: questions it asked him, decisions
 * it left to him and blockers only he can clear. Derived here rather than emitted by the agent, so every harness gets it
 * without a tool or an output convention of its own (docs/adr/decisions.log, T-BLOCKCARD). Most turns leave none.
 */
export function suggestOpenItems(threadId: string, runText: string) {
  if (!config.suggestions) return;
  const call = ++suggestSeq;
  openCalls.set(threadId, call);
  const t = threads.get(threadId);
  const prompt =
    `${userName()} is working with a coding agent. Read the agent's answer below and list what it leaves for ${userName()} to resolve ` +
    'before this thread can be closed. Three kinds count:\n' +
    `QUESTION: a question the agent asked ${userName()} and needs answered to finish\n` +
    `DECISION: a choice the agent left to ${userName()}, with the options it named\n` +
    `BLOCKER: something only ${userName()} can do or provide before the work can finish, such as a login, a secret, an approval or a file\n\n` +
    'List only items the answer states or plainly asks for, most important first, at most 5. Never list work the agent will do ' +
    'itself, optional ideas, a summary of what was done, or a closing line such as "let me know if you need anything else". ' +
    'If nothing is left open, output NONE. Most answers get NONE.\n\n' +
    'Answer in exactly this format, one item per line, plain text, no quotes, no em dashes, nothing else:\n' +
    'QUESTION: <the question, one self-contained sentence naming what it is about>\n' +
    'DECISION: <the choice, one self-contained sentence> | <option> | <option>\n' +
    'BLOCKER: <what is needed and why, one self-contained sentence>\n\n' +
    'Thread: ' + (t?.title ?? '') +
    `\n\n${userPossessive()} last message:\n` + events.lastUserText(threadId).slice(0, 1500) +
    "\n\nThe agent's answer:\n" + runText.slice(-4000);
  haiku('omni-os-open-items', prompt, (out) => {
    if (openCalls.get(threadId) !== call) return;
    openCalls.delete(threadId);
    const items = out ? parseOpenItems(out) : null;
    if (!items || threads.get(threadId)?.status !== 'done') return;
    if (threads.setOpenItems(threadId, storeOpenItems(items))) emitThread(threadId);
  });
}

export function fallbackTitle(prompt: string) {
  const first = prompt.trim().split('\n')[0].replace(/\s+/g, ' ');
  return first.length > 70 ? first.slice(0, 67) + '...' : first || 'Untitled';
}

export function generateTitle(threadId: string, prompt: string) {
  const placeholder = threads.get(threadId)?.title;
  const ask =
    'Write a title of at most 7 words for this task. Plain text, no quotes, no trailing period, no em dashes. ' +
    'Output the title only.\n\nTask:\n' + prompt.slice(0, 3000);
  haiku('omni-os-title', ask, (out) => {
    const title = out?.split('\n').filter(Boolean).pop()?.replace(/^["']|["']$/g, '').slice(0, 90);
    const t: Thread | undefined = threads.get(threadId);
    // Only in place of the placeholder: Ben may have renamed it while this ran.
    if (title && t && t.title === placeholder) {
      threads.update(threadId, { title, updated_at: t.updated_at });
      emitThread(threadId);
    }
  });
}
