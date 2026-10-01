// Haiku sidecars: a title for a new thread, and a suggested reply after a turn.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { closePipesAfterExit } from '../child.ts';
import { config } from '../config.ts';
import { events, threads, type Thread } from '../db.ts';
import { harnessEnv } from '../harness/env-guard.ts';
import { emitThread } from './state.ts';

/** Each thread's latest suggestion call. A message sent while one runs makes its answer stale. */
const suggestCalls = new Map<string, number>();
let suggestSeq = 0;

export function clearSuggestion(threadId: string) {
  suggestCalls.delete(threadId);
  if (threads.setSuggestion(threadId, null)) emitThread(threadId);
}

/** Guess Ben's next reply from his last message and the agent's answer, for the reply box to offer. */
export function suggestReply(threadId: string, runText: string) {
  if (!config.suggestions) return;
  const call = ++suggestSeq;
  suggestCalls.set(threadId, call);
  const child = spawn(
    config.claudeBin,
    ['-p', '--model', 'haiku', '--output-format', 'text', '--strict-mcp-config', '--no-session-persistence', '--tools', ''],
    { cwd: tmpdir(), env: harnessEnv('claude-code', { CLAUDE_CODE_ENTRYPOINT: 'omni-os-suggest' }), stdio: ['pipe', 'pipe', 'ignore'] },
  );
  closePipesAfterExit(child);
  child.stdin.on('error', () => {});
  child.stdin.end(
    'Ben is working with a coding agent. Predict the short reply Ben is most likely to send next, in his voice: ' +
      'a direct instruction or answer of at most 12 words, e.g. "Yes, open a PR" or "Run the tests first". ' +
      'Plain text, no quotes, no em dashes. If there is no obvious next step, output NONE. Output the reply only.\n\n' +
      "Ben's last message:\n" + events.lastUserText(threadId).slice(0, 1500) +
      "\n\nThe agent's answer:\n" + runText.slice(-3000),
  );
  let out = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
  child.stdout.on('data', (d) => (out += d));
  child.on('close', (code) => {
    clearTimeout(timer);
    if (suggestCalls.get(threadId) !== call) return;
    suggestCalls.delete(threadId);
    const text = out.trim().split('\n').filter(Boolean).pop()?.replace(/^["']|["']$/g, '').trim().slice(0, 200);
    if (code !== 0 || !text || /^none\.?$/i.test(text)) return;
    // Nobody waits on this call: a shutdown may have closed the db by the time it ends.
    try {
      if (threads.get(threadId)?.status !== 'done') return;
      if (threads.setSuggestion(threadId, text)) emitThread(threadId);
    } catch {
      return;
    }
  });
  child.on('error', () => clearTimeout(timer));
}

export function fallbackTitle(prompt: string) {
  const first = prompt.trim().split('\n')[0].replace(/\s+/g, ' ');
  return first.length > 70 ? first.slice(0, 67) + '...' : first || 'Untitled';
}

export function generateTitle(threadId: string, prompt: string) {
  const placeholder = threads.get(threadId)?.title;
  const child = spawn(
    config.claudeBin,
    ['-p', '--model', 'haiku', '--output-format', 'text', '--strict-mcp-config', '--no-session-persistence', '--tools', ''],
    { cwd: tmpdir(), env: harnessEnv('claude-code', { CLAUDE_CODE_ENTRYPOINT: 'omni-os-title' }), stdio: ['pipe', 'pipe', 'ignore'] },
  );
  closePipesAfterExit(child);
  child.stdin.on('error', () => {});
  child.stdin.end(
    'Write a title of at most 7 words for this task. Plain text, no quotes, no trailing period, no em dashes. ' +
      'Output the title only.\n\nTask:\n' + prompt.slice(0, 3000),
  );
  let out = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
  child.stdout.on('data', (d) => (out += d));
  child.on('close', (code) => {
    clearTimeout(timer);
    const title = out.trim().split('\n').filter(Boolean).pop()?.replace(/^["']|["']$/g, '').slice(0, 90);
    // Nobody waits on this call: a shutdown may have closed the db by the time it ends.
    let t: Thread | undefined;
    try {
      t = threads.get(threadId);
    } catch {
      return;
    }
    // Only in place of the placeholder: Ben may have renamed it while this ran.
    if (code === 0 && title && t && t.title === placeholder) {
      threads.update(threadId, { title, updated_at: t.updated_at });
      emitThread(threadId);
    }
  });
  child.on('error', () => clearTimeout(timer));
}
