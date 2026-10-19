// Starting and messaging Claude Code cloud sessions. Two ways in, both billed to the Claude plan:
//   - the CLI. A self-hosted pool (`ccpool_…`) starts with `claude -p <brief> --environment <id> --output-format json`,
//     which exits with the session id as JSON. An Anthropic-hosted environment (`env_…`) is not accepted there, so it
//     starts with `claude --cloud <brief>` and the environment pinned through --settings. That form insists on a
//     terminal, so it runs under script(1) and Omni reads the `session_…` id it prints. `claude -p <msg> --cloud <id>
//     --output-format json` queues a message into either. All use the claude.ai login the CLI keeps in the Keychain,
//     so Omni never handles that token.
//   - a routine's API trigger: POST /fire with the routine's own bearer token (Keychain secret CLAUDE_ROUTINE_TOKEN).
// See docs/adr/0005-claude-code-cloud-harness.md and code.claude.com/docs/en/claude-code-on-the-web.
import { execFile } from 'node:child_process';

export interface CloudSession {
  id: string;
  url: string;
}

export interface Exec {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (bin: string, args: string[], opts: { cwd?: string; env: NodeJS.ProcessEnv; signal?: AbortSignal }) => Promise<Exec>;

export const execRunner: Runner = (bin, args, opts) =>
  new Promise((resolve) => {
    execFile(bin, args, { cwd: opts.cwd, env: opts.env, signal: opts.signal, timeout: 120_000, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (err && code !== 0 && !stdout ? err.message : '') });
    });
  });

/** The claude.ai link for a session id, in either its `session_` or `cse_` spelling. */
export const sessionUrl = (id: string) => `https://claude.ai/code/${normalizeSessionId(id)}`;

/** `cse_…` (what a session sees in CLAUDE_CODE_REMOTE_SESSION_ID) and `session_…` (what the CLI prints) are the same id. */
export const normalizeSessionId = (id: string) => id.trim().replace(/^cse_/, 'session_');

export const isCloudSessionId = (id: string | null | undefined) => !!id && /^(session|cse)_[A-Za-z0-9]+$/.test(id.trim());

/** The last JSON object line in the CLI's stdout. */
export function lastJson(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]) as Record<string, unknown>;
    } catch {
      /* not this line */
    }
  }
  return null;
}

/** Turn a dispatch's output into a session, or throw with the CLI's own reason. */
export function parseDispatch(out: Exec, what: string): CloudSession {
  const json = lastJson(out.stdout);
  if (json && json.ok === true && typeof json.session_id === 'string') {
    const id = normalizeSessionId(json.session_id);
    return { id, url: typeof json.url === 'string' && json.url ? json.url : sessionUrl(id) };
  }
  const reason = (json && typeof json.error === 'string' && json.error) || out.stderr.trim() || out.stdout.trim() || `claude exited ${out.code}`;
  throw new Error(`${what} failed: ${reason.slice(0, 1000)}`);
}

/** The remote's default branch (`main`), so a session never starts from a local branch nothing has pushed. */
export async function defaultRef(cwd: string, env: NodeJS.ProcessEnv, run: Runner = execRunner): Promise<string | null> {
  const out = await run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd, env });
  const ref = out.code === 0 ? out.stdout.trim().replace(/^origin\//, '') : '';
  return ref || null;
}

export interface CreateOpts {
  bin: string;
  brief: string;
  environment: string;
  /** A git checkout of the repo, so the CLI can find its GitHub remote. */
  cwd: string;
  env: NodeJS.ProcessEnv;
  ref?: string | null;
  model?: string | null;
  signal?: AbortSignal;
}

/** A self-hosted environment pool, the only kind `claude --environment` takes. */
export const isPoolId = (id: string) => id.trim().startsWith('ccpool_');

/** The command that creates a session: `--environment` for a pool, `--cloud` under a pseudo-terminal otherwise. */
export function createCommand(o: Pick<CreateOpts, 'bin' | 'brief' | 'environment' | 'ref' | 'model'>): { bin: string; args: string[] } {
  const env = o.environment.trim();
  const args = isPoolId(env)
    ? ['-p', o.brief, '--environment', env, '--output-format', 'json']
    : ['--cloud', o.brief, '--settings', JSON.stringify({ remote: { defaultEnvironmentId: env } })];
  if (o.ref) args.push('--ref', o.ref);
  if (o.model) args.push('--model', o.model);
  if (isPoolId(env)) return { bin: o.bin, args };
  // script(1) gives claude its terminal. Its own input has to be /dev/null: macOS script fails on the socket Node pipes in.
  return { bin: '/bin/sh', args: ['-c', 'exec script -q /dev/null "$@" < /dev/null', 'sh', o.bin, ...args] };
}

/** Terminal escapes, so the text `claude --cloud` draws reads as plain lines. */
const stripAnsi = (s: string) => s.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?<>]*[A-Za-z]/g, '').replace(/\x1b[()][A-Za-z0-9]/g, '');

/** Read the session `claude --cloud` printed ("Created cloud session … View: https://claude.ai/code/session_…"). */
export function parseCloudCreate(out: Exec, what: string): CloudSession {
  const text = stripAnsi(out.stdout + '\n' + out.stderr);
  const id = /\b(session_[A-Za-z0-9]+)\b/.exec(text)?.[1];
  if (out.code === 0 && id) return { id, url: sessionUrl(id) };
  const reason = /Error:[^\r\n]*/.exec(text)?.[0] || text.replace(/\s+/g, ' ').trim() || `claude exited ${out.code}`;
  throw new Error(`${what} failed: ${reason.slice(0, 1000)}`);
}

/** Start a new cloud session from the CLI. It returns as soon as the session exists, not when Claude answers. */
export async function createViaCli(o: CreateOpts, run: Runner = execRunner): Promise<CloudSession> {
  const cmd = createCommand(o);
  const out = await run(cmd.bin, cmd.args, { cwd: o.cwd, env: o.env, signal: o.signal });
  return isPoolId(o.environment) ? parseDispatch(out, 'Starting the cloud session') : parseCloudCreate(out, 'Starting the cloud session');
}

/** Queue a message into a running cloud session. */
export async function sendViaCli(o: { bin: string; id: string; text: string; env: NodeJS.ProcessEnv; signal?: AbortSignal }, run: Runner = execRunner): Promise<CloudSession> {
  const args = ['-p', o.text, '--cloud', o.id, '--output-format', 'json'];
  return parseDispatch(await run(o.bin, args, { env: o.env, signal: o.signal }), 'Sending to the cloud session');
}

/** The routine fire endpoint's beta header. Breaking changes ship behind a new dated header. */
export const ROUTINE_BETA = 'experimental-cc-routine-2026-04-01';

/** Fire a routine through its API trigger. `text` reaches it wrapped as untrusted payload, so its saved prompt must act on it. */
export async function fireRoutine(o: { url: string; token: string; text: string; signal?: AbortSignal }, fetchImpl: typeof fetch = fetch): Promise<CloudSession> {
  const res = await fetchImpl(o.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${o.token}`,
      'anthropic-beta': ROUTINE_BETA,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ text: o.text }),
    signal: o.signal,
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body || typeof body.claude_code_session_id !== 'string') {
    const msg = (body?.error as { message?: string } | undefined)?.message;
    throw new Error(`Firing the routine failed: HTTP ${res.status}${msg ? ` ${msg}` : ''}`);
  }
  const id = normalizeSessionId(body.claude_code_session_id);
  return { id, url: typeof body.claude_code_session_url === 'string' ? body.claude_code_session_url : sessionUrl(id) };
}
