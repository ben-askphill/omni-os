// Haiku sidecars: a title for a new thread, and after a turn a suggested reply and a proposed follow-up thread.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { closePipesAfterExit } from '../child.ts';
import { config } from '../config.ts';
import { events, threads, type Thread } from '../db.ts';
import { harnessEnv } from '../harness/env-guard.ts';
import { emitThread } from './state.ts';

/** Each thread's latest suggestion calls. A message sent while one runs makes its answer stale. */
const suggestCalls = new Map<string, number>();
const nextCalls = new Map<string, number>();
let suggestSeq = 0;

/** One Haiku call with no tools and no session. `done` gets its trimmed output, or null when it failed. */
function haiku(entrypoint: string, prompt: string, done: (out: string | null) => void) {
  const child = spawn(
    config.claudeBin,
    ['-p', '--model', 'haiku', '--output-format', 'text', '--strict-mcp-config', '--no-session-persistence', '--tools', ''],
    { cwd: tmpdir(), env: harnessEnv('claude-code', { CLAUDE_CODE_ENTRYPOINT: entrypoint }), stdio: ['pipe', 'pipe', 'ignore'] },
  );
  closePipesAfterExit(child);
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  let out = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
  child.stdout.on('data', (d) => (out += d));
  child.on('close', (code) => {
    clearTimeout(timer);
    // Nobody waits on these calls: a shutdown may have closed the db by the time one ends.
    try {
      done(code === 0 ? out.trim() : null);
    } catch {
      return;
    }
  });
  child.on('error', () => clearTimeout(timer));
}

/** Drop the thread's suggested reply and proposed follow-up thread, and any answer still on its way. */
export function clearSuggestion(threadId: string) {
  suggestCalls.delete(threadId);
  nextCalls.delete(threadId);
  const a = threads.setSuggestion(threadId, null);
  const b = threads.setNextThread(threadId, null);
  if (a || b) emitThread(threadId);
}

/** Guess Ben's next reply from his last message and the agent's answer, for the reply box to offer. */
export function suggestReply(threadId: string, runText: string) {
  if (!config.suggestions) return;
  const call = ++suggestSeq;
  suggestCalls.set(threadId, call);
  const prompt =
    'Ben is working with a coding agent. Predict the short reply Ben is most likely to send next, in his voice: ' +
    'a direct instruction or answer of at most 12 words, e.g. "Yes, open a PR" or "Run the tests first". ' +
    'Plain text, no quotes, no em dashes. If there is no obvious next step, output NONE. Output the reply only.\n\n' +
    "Ben's last message:\n" + events.lastUserText(threadId).slice(0, 1500) +
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
    'Ben is working with a coding agent. Read the agent\'s answer below. If it clearly leaves follow-up work that is separate ' +
    'from this task and would run best as its own new thread (work it deferred or left for Ben to decide, a next phase, ' +
    'a problem it found but did not fix), write a task card for that new thread. Otherwise output NONE. Most answers ' +
    'get NONE: never propose one for answering a question, approving, running tests, opening a PR or carrying on the same task.\n\n' +
    'Answer in exactly this format, plain text, no quotes, no em dashes:\n' +
    'TITLE: <the new thread\'s title, at most 8 words>\n' +
    'PROMPT: <its first message, written as Ben would ask: 1 to 4 sentences, self-contained since the new thread cannot ' +
    'see this one, naming the repo, files, findings and constraints it needs>\n\n' +
    'Thread: ' + (t?.title ?? '') +
    "\n\nBen's last message:\n" + events.lastUserText(threadId).slice(0, 1500) +
    "\n\nThe agent's answer:\n" + runText.slice(-4000);
  haiku('omni-os-next-thread', prompt, (out) => {
    if (nextCalls.get(threadId) !== call) return;
    nextCalls.delete(threadId);
    const next = out ? parseNextThread(out) : null;
    if (!next || threads.get(threadId)?.status !== 'done') return;
    if (threads.setNextThread(threadId, next)) emitThread(threadId);
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
