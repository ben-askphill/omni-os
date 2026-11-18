// Whether this machine's GitHub CLI is installed and signed in, for onboarding (GET /api/setup/github, `npm run
// setup`). github.ts runs the same `gh` for PRs, checks and auto-merge, so this is the check those need. Onboarding's
// Connect GitHub signs gh in through its own web flow (startGithubLogin): Omni shows the code, gh keeps the token.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ghLoginFailure, ghMissing, parseGhAuthStatus, parseGhDeviceCode, type GhLoginPoll, type GhLoginStart, type GithubCheck } from '@omni/shared/github-check.ts';

const CHECK_MS = 8_000;

const options: { bin: string; env?: NodeJS.ProcessEnv; platform: string; startMs: number; lifeMs: number } = {
  bin: 'gh',
  platform: process.platform,
  startMs: 20_000,
  // GitHub's device codes last 15 minutes and gh gives up then by itself. This stops one that does not.
  lifeMs: 16 * 60_000,
};
/** For tests: a fake gh, its environment, the platform the install hint is for, and the login flow's time limits. */
export function configureGithubAuth(o: Partial<typeof options>) {
  Object.assign(options, o);
}

/** `gh auth status` for github.com. Never rejects: no binary is `missing`, a stalled gh is `error`. */
export function githubAuth(): Promise<GithubCheck> {
  return new Promise((resolve) => {
    execFile(
      options.bin,
      ['auth', 'status', '--hostname', 'github.com'],
      { env: options.env ?? process.env, timeout: CHECK_MS, maxBuffer: 256 * 1024, killSignal: 'SIGKILL' },
      (err, stdout, stderr) => {
        const code = (err as NodeJS.ErrnoException | null)?.code;
        if (code === 'ENOENT' || code === 'EACCES') return resolve(ghMissing(options.platform));
        // gh writes the status to stdout, or to stderr when something is wrong (and on older versions, always).
        resolve(parseGhAuthStatus(`${stdout ?? ''}\n${stderr ?? ''}`, !err));
      },
    );
  });
}

// ---------- Connect GitHub: `gh auth login --web` ----------

/** A refusal the API answers with this status and message. */
export class GhLoginError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 502,
  ) {
    super(message);
  }
}

interface Login {
  flow: string;
  secretHash: Buffer;
  child: ChildProcess;
  /** Set once gh has stopped, been cancelled or replaced, so a late poll gets the answer. */
  ended: Exclude<GhLoginPoll, { state: 'pending' }> | null;
  timer: NodeJS.Timeout;
}

/** One sign-in at a time: a second Connect stops the first, whose page then says to start again. */
let current: Login | null = null;

const sha256 = (s: string) => createHash('sha256').update(s).digest();
/** The client polls the server, which only reads what gh has printed, so it can ask often. */
const POLL_S = 2;
const OUTPUT_MAX = 64 * 1024;

/**
 * Runs `gh auth login --web --hostname github.com` and answers once gh has printed its one-time code. With no
 * terminal gh asks nothing, opens no browser and polls GitHub until the code is entered, declined or expires; then
 * it stores the token where it always does (the keychain, or its own config). Omni never reads the token.
 */
export function startGithubLogin(): Promise<GhLoginStart> {
  stopGithubLogin();
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(options.bin, ['auth', 'login', '--web', '--hostname', 'github.com'], { env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(new GhLoginError((err as Error).message, 502));
    }
    const secret = randomBytes(24).toString('hex');
    const login: Login = { flow: randomUUID(), secretHash: sha256(secret), child, ended: null, timer: setTimeout(() => halt(login, { state: 'expired' }), options.lifeMs) };
    login.timer.unref();
    // Current from the start, so a second Connect before gh has printed its code still stops this one.
    current = login;
    let out = '';
    let started = false;
    const noCode = setTimeout(() => {
      const error = `gh gave no sign-in code in ${options.startMs / 1000}s. Check this machine can reach github.com, or run gh auth login in a terminal.`;
      halt(login, { state: 'refused', error });
      reject(new GhLoginError(error, 502));
    }, options.startMs);
    const read = (chunk: Buffer) => {
      out = (out + chunk.toString()).slice(-OUTPUT_MAX);
      if (started) return;
      const code = parseGhDeviceCode(out);
      if (!code) return;
      started = true;
      clearTimeout(noCode);
      resolve({ flow: login.flow, secret, ...code, verificationUriComplete: null, interval: POLL_S });
    };
    child.stdout!.on('data', read);
    child.stderr!.on('data', read);
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(noCode);
      halt(login, { state: 'refused', error: err.message });
      reject(new GhLoginError(err.code === 'ENOENT' || err.code === 'EACCES' ? 'The GitHub CLI is not installed on the machine Omni runs on.' : err.message, err.code === 'ENOENT' ? 409 : 502));
    });
    child.on('close', (code) => {
      clearTimeout(noCode);
      clearTimeout(login.timer);
      if (!started && login.ended) return reject(new GhLoginError('Another Connect GitHub started in its place.', 409));
      // Before a code: gh refused to start, as it does when GH_TOKEN is set. Its last line says why.
      if (!started) return reject(new GhLoginError(out.trim().split('\n').pop()?.trim() || `gh auth login stopped (exit ${code}) before it gave a code.`, 502));
      if (login.ended) return;
      if (code !== 0) return void (login.ended = ghLoginFailure(out));
      void githubAuth().then((check) => {
        login.ended =
          check.state === 'ready' && check.login
            ? { state: 'signed_in', login: check.login }
            : { state: 'refused', error: 'gh finished, but gh auth status shows no login. Run it in a terminal to see why.' };
      });
    });
  });
}

/** Ends a sign-in that is still waiting and stops its gh, so a code entered afterwards signs nothing in. */
function halt(l: Login, why: NonNullable<Login['ended']>) {
  if (l.ended) return;
  l.ended = why;
  clearTimeout(l.timer);
  l.child.kill('SIGTERM');
}

function find(flow: string, secret: string): Login {
  const l = current;
  if (!l || l.flow !== flow || !timingSafeEqual(l.secretHash, sha256(secret))) throw new GhLoginError('No such sign-in. Start again.', 404);
  return l;
}

/** One poll from the page that started the sign-in: pending while gh waits, then how it ended. */
export function pollGithubLogin(flow: string, secret: string): GhLoginPoll {
  return find(flow, secret).ended ?? { state: 'pending' };
}

export function cancelGithubLogin(flow: string, secret: string) {
  halt(find(flow, secret), { state: 'refused', error: 'Cancelled.' });
}

/** Stops the running sign-in, if any: before another starts, and when the server shuts down. */
export function stopGithubLogin() {
  const l = current;
  current = null;
  if (l) halt(l, { state: 'refused', error: 'Stopped.' });
}
