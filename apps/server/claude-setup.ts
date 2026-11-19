// Install and sign in to Claude Code from the first-run screens, with no terminal (/api/setup/claude*). Install runs
// Claude Code's own installer on the machine Omni runs on; it puts `claude` in ~/.local/bin, which the desktop app's
// server has on its PATH. Sign in runs `claude auth login`, which prints a claude.com page to open and then waits for
// the code that page shows: the user opens the page, pastes the code, and Omni hands it to the CLI. Claude Code keeps
// the login itself, as it does from a terminal; Omni never sees the token. `claude auth status --json` says whether it
// worked. One install and one sign-in at a time.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ClaudeLoginStart, ClaudeSetup, ClaudeStep } from '@omni/shared/claude-setup.ts';
import { config } from './config.ts';
import { parseClaudeStatus } from './harness/accounts-parse.ts';
import { claudeProbeOf } from './harness/catalog.ts';
import { claudeAuthStatus, loadCatalog } from './harness/catalog-service.ts';
import { harnessEnv } from './harness/env-guard.ts';

/** Claude Code's own installer. `OMNI_CLAUDE_INSTALL` names another command, for tests and QA stacks. */
export const CLAUDE_INSTALL = 'curl -fsSL https://claude.ai/install.sh | bash';
const installCommand = () => process.env.OMNI_CLAUDE_INSTALL || CLAUDE_INSTALL;

/** How long sign-in waits for the CLI to print its page, and for it to finish once it has the code. */
const URL_MS = 20_000;
const CODE_MS = 30_000;
/** A sign-in nobody finishes is stopped then, so no `claude auth login` waits for ever. */
const WAIT_MS = 15 * 60_000;
/** An install that has not finished by then is stopped. */
const INSTALL_MS = 5 * 60_000;
/** The output a failed step shows: its last lines. */
const TAIL = 1200;

const tail = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim().slice(-TAIL);

/**
 * Whether Claude Code is installed and signed in here. The same reading as the harness catalog and Settings > Accounts:
 * one `claude auth status --json` (catalog-service.ts), signed out by catalog.ts claudeProbeOf, who and which plan by
 * accounts-parse.ts parseClaudeStatus.
 */
export async function claudeSetup(bin = config.claudeBin): Promise<ClaudeSetup> {
  const out = await claudeAuthStatus(bin);
  const probe = claudeProbeOf(out);
  if (probe.missing) return { state: 'missing', install: installCommand() };
  if (!probe.available) return { state: 'signed-out' };
  const a = out.stdout ? parseClaudeStatus(out.stdout) : null;
  // An older CLI without `auth status`, or one that did not answer or say as whom: Omni cannot tell, so it does not ask.
  if (a?.state !== 'signed-in') return { state: 'unknown' };
  return { state: 'ready', ...(a.label && { email: a.label }), ...(a.plan && { plan: a.plan }) };
}

/** Read the harness catalog again, so pickers and the Harnesses step see the new state. */
const recheck = () => void loadCatalog(['claude-code']).catch(() => {});

// ---------- Install ----------

interface Flow {
  id: string;
  child: ChildProcess;
  out: string;
  state: ClaudeStep['state'];
  error?: string;
}

let install: Flow | null = null;

/** Start the installer, or answer the one already running. */
export function startInstall(): { flow: string } {
  if (install?.state === 'running') return { flow: install.id };
  const child = spawn('/bin/sh', ['-c', installCommand()], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const flow: Flow = { id: randomUUID(), child, out: '', state: 'running' };
  install = flow;
  const add = (b: Buffer) => (flow.out = (flow.out + b.toString()).slice(-8 * TAIL));
  child.stdout?.on('data', add);
  child.stderr?.on('data', add);
  const timer = setTimeout(() => child.kill('SIGKILL'), INSTALL_MS);
  child.on('error', (err) => ((flow.state = 'failed'), (flow.error = err.message)));
  child.on('close', (code) => {
    clearTimeout(timer);
    if (flow.state !== 'running') return;
    flow.state = code === 0 ? 'done' : 'failed';
    if (code !== 0) flow.error = tail(flow.out) || `The installer exited with ${code ?? 'a signal'}.`;
    recheck();
  });
  return { flow: flow.id };
}

export function installStep(id: string): ClaudeStep | null {
  if (install?.id !== id) return null;
  return { state: install.state, ...(install.error && { error: install.error }) };
}

// ---------- Sign in ----------

interface Login extends Flow {
  url?: string;
}

let login: Login | null = null;

const AUTHORIZE = /https:\/\/\S+\/oauth\/authorize\?\S+/;

/** Why the CLI's sign-in failed, in its own words ("Login failed: That code wasn't accepted. ..."), without the page URL. */
export const loginError = (out: string) => /Login failed:[^\n]*/.exec(out)?.[0].trim() ?? tail(out.replace(AUTHORIZE, '')).split('\n').at(-1) ?? '';

function stopLogin(l: Login | null) {
  if (l && l.child.exitCode === null) l.child.kill('SIGKILL');
}

/**
 * Start `claude auth login` and answer the page it asks the user to open, once it has printed it. A sign-in already
 * waiting is stopped first, so its old code cannot finish it.
 */
export function startLogin(bin = config.claudeBin): Promise<ClaudeLoginStart> {
  stopLogin(login);
  // BROWSER: the CLI would open the page on this machine itself; the card links to it instead, wherever it is opened.
  const child = spawn(bin, ['auth', 'login'], { env: harnessEnv('claude-code', { BROWSER: 'true' }), stdio: ['pipe', 'pipe', 'pipe'] });
  const l: Login = { id: randomUUID(), child, out: '', state: 'running' };
  login = l;
  return new Promise((resolve, reject) => {
    const fail = (why: string) => {
      l.state = 'failed';
      l.error = why;
      stopLogin(l);
      reject(Object.assign(new Error(why), { status: 502 }));
    };
    const timer = setTimeout(() => fail(`claude auth login printed no sign-in page within ${URL_MS / 1000} s.${l.out ? ` It said: ${tail(l.out)}` : ''}`), URL_MS);
    const add = (b: Buffer) => {
      l.out = (l.out + b.toString()).slice(-8 * TAIL);
      const url = l.url ? null : AUTHORIZE.exec(l.out)?.[0];
      if (url) {
        l.url = url;
        clearTimeout(timer);
        setTimeout(() => {
          if (l.state !== 'running') return;
          l.state = 'failed';
          l.error = 'The sign-in waited too long. Start it again.';
          stopLogin(l);
        }, WAIT_MS).unref();
        resolve({ flow: l.id, url });
      }
    };
    child.stdout?.on('data', add);
    child.stderr?.on('data', add);
    child.on('error', (err) => (clearTimeout(timer), fail(err.message)));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (l.state !== 'running') return;
      // It can finish on its own: a browser on this machine came back to it.
      l.state = code === 0 ? 'done' : 'failed';
      if (code !== 0) l.error = loginError(l.out) || `claude auth login exited with ${code ?? 'a signal'}.`;
      if (!l.url) reject(Object.assign(new Error(l.error ?? 'claude auth login stopped before it printed a sign-in page.'), { status: 502 }));
      recheck();
    });
  });
}

const exited = (child: ChildProcess, ms: number) =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(resolve, ms);
    child.once('close', () => (clearTimeout(timer), resolve()));
  });

/** Hand the pasted code to the waiting CLI, wait for it to finish, and answer what `claude auth status` says then. */
export async function submitCode(id: string, code: string): Promise<ClaudeStep & { setup?: ClaudeSetup }> {
  const l = login;
  if (!l || l.id !== id) return { state: 'failed', error: 'This sign-in is no longer waiting. Start it again.' };
  if (l.state === 'running') {
    l.child.stdin?.write(`${code.trim()}\n`);
    await exited(l.child, CODE_MS);
    if (l.state === 'running') {
      stopLogin(l);
      l.state = 'failed';
      l.error = `Claude Code did not finish signing in within ${CODE_MS / 1000} s.`;
    }
  }
  const setup = await claudeSetup();
  recheck();
  if (setup.state === 'ready') return { state: 'done', setup };
  return { state: 'failed', error: l.error ?? 'Claude Code is still signed out. Check the code and try again.', setup };
}

export function cancelLogin(id: string) {
  if (login?.id !== id) return;
  stopLogin(login);
  login.state = 'failed';
  login.error = 'Cancelled.';
}
