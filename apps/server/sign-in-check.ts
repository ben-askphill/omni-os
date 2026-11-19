import { execFile } from 'node:child_process';
import { config } from './config.ts';
import { judge, parseInitServers, parseMcpList, type ServerStates, type SignInCheck } from './connectors.ts';
import { harnessEnv } from './harness/env-guard.ts';

// Reading Claude Code's connector sign-ins for the sign-in check (connectors.ts): the newest session init on this
// machine, else a live `claude mcp list`.

/** A reading younger than this that says every needed connector is signed in is trusted without a live check. */
const TRUST_MS = 10 * 60_000;
/** A live check this young answers again, so a burst of new threads runs one `claude mcp list`. */
const LIVE_MS = 30_000;
/** A live check that fails falls back to a reading this young. */
const FALLBACK_MS = 60 * 60_000;
/** How long `claude mcp list` may take. It connects to every server. */
const LIST_TIMEOUT_MS = 20_000;

interface Reading {
  servers: ServerStates;
  at: number;
}

/** The newest init a Claude Code session on this machine reported (runner/records.ts). */
let lastInit: Reading | null = null;
/** Live checks by folder, since a project's .mcp.json adds servers. In flight or settled. */
const live = new Map<string, { at: number; job: Promise<ServerStates | null> }>();

/** A Claude Code session here just started: its servers' states are the freshest reading there is. */
export function noteInitServers(list: readonly string[], at = Date.now()) {
  if (list.length) lastInit = { servers: parseInitServers(list), at };
}

type Lister = (cwd: string) => Promise<string | null>;

const listWithCli: Lister = (cwd) =>
  new Promise((resolve) => {
    execFile(
      config.claudeBin,
      ['mcp', 'list'],
      { cwd, env: harnessEnv('claude-code', {}, {}), timeout: LIST_TIMEOUT_MS, maxBuffer: 512 * 1024, killSignal: 'SIGKILL' },
      // It exits non-zero when a server fails to connect, and its stdout still answers.
      (_err, stdout) => resolve(stdout?.trim() ? stdout : null),
    );
  });

let lister: Lister = listWithCli;

/** For tests: what stands in for `claude mcp list` (null: it did not answer), and a clean slate. */
export function configureSignInCheck(o: { list?: Lister | null; reset?: boolean }) {
  if (o.list !== undefined) lister = o.list ?? listWithCli;
  if (o.reset) {
    lastInit = null;
    live.clear();
  }
}

function liveServers(cwd: string): Promise<ServerStates | null> {
  const hit = live.get(cwd);
  if (hit && Date.now() - hit.at < LIVE_MS) return hit.job;
  const job = lister(cwd)
    .then((out) => (out ? parseMcpList(out) : null))
    .catch(() => null);
  live.set(cwd, { at: Date.now(), job });
  return job;
}

/**
 * Whether the connectors the job needs are signed in on this machine. A recent init that says they all are answers
 * at once; anything else (a signed-out one, an old or missing reading) asks `claude mcp list`, so a sign-in the user
 * just made is seen. When that does not answer, a reading from the last hour stands in, and with none it is unknown.
 */
export async function checkSignIn(ids: readonly string[], cwd: string): Promise<SignInCheck> {
  if (!ids.length) return { signedOut: [], signedIn: [], unknown: [] };
  const now = Date.now();
  if (lastInit && now - lastInit.at < TRUST_MS) {
    const quick = judge(ids, lastInit.servers);
    if (quick.signedIn.length === ids.length) return quick;
  }
  const servers = await liveServers(cwd);
  if (servers) return judge(ids, servers);
  return judge(ids, lastInit && now - lastInit.at < FALLBACK_MS ? lastInit.servers : null);
}
