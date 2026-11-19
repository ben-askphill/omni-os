// Which requests may act (PRD #667, S8, S14, S18, S12). One pure decision from what a request says about itself and the
// kind of route it is for; request-guard.ts gathers the facts and turns a refusal into a response.
//
// - Only same-origin and none pass Sec-Fetch-Site. same-site is a page on another port of the same host (a dev server,
//   a container's UI): cookies ignore ports, so it counts as foreign, like cross-site.
// - An Origin, when sent, must be the Host the request came in on.
// - A body type a page can send without a preflight (text/plain, form-urlencoded) is refused.
// - A shell on this machine: only the install's token, or a session paired with the token (a browser or the desktop
//   app's window), may open, type into or watch a thread's terminal, or add, change, run or retry a channel action,
//   whose command a login shell runs. A Google, Omni Connect or app session cannot, so a stolen session cannot read
//   data/api-token through a shell. A thread's own token cannot either: a thread runs its own shells. Reading actions
//   and runs, stopping a run and removing an action stay open to all of them.
//   Retry setup reruns the channel's setup step, so it is a shell too, but only while the thread has one to rerun:
//   that depends on the thread, not the path, so runner/setup.ts checks it with request-guard.ts shellAllowed.
//   Saving an automation is a shell only when its YAML adds or changes a precheck, a command a login shell runs
//   before each scheduled run, so automation-files.ts checks that the same way. A precheck already saved keeps running.
// - No GET opens a shell or starts Chrome: the terminal and channel browser start on POST, and their streams only
//   attach (terminal-api.ts, browser-api.ts), so an <img> in a PR body cannot do either. Reads that run git (the PR
//   lookup's branch follow) stay GETs.
// - The desktop pairing link takes a one-time nonce and only a top-level navigation the app's main process made
//   (Sec-Fetch-Site absent or none).

/**
 * How a request proved itself. `session-token`: a device session paired with the install's token. `thread`: the token
 * one spawn of a thread's harness holds (thread-tokens.ts), which is never the install's: it opens no terminal and
 * pairs nothing.
 */
export type Credential = 'token' | 'session-token' | 'session' | 'thread' | 'nonce' | 'none';

/** What the route does. A shell (a thread's terminal, a channel action's command) and pairing have stricter rules. */
export type RouteClass = 'read' | 'act' | 'shell' | 'pairing';

export interface RequestFacts {
  method: string;
  route: RouteClass;
  /** The Host header's name is one the server answers to (request-guard.ts hostAllowed). */
  hostAllowed: boolean;
  /** Sec-Fetch-Site, when the client sent it. */
  fetchSite?: string;
  /** The Origin header, when sent. */
  origin?: string;
  /** The Host (and X-Forwarded-Host) the request came in on. */
  hosts: readonly string[];
  /** The Origin's host is one the server answers to. */
  originAllowed: boolean;
  contentType?: string;
  credential: Credential;
  /** The route needs no credential (the proof, webhooks, sign-in, pairing redemption, Connect). */
  open: boolean;
}

export type Decision = { ok: true } | { ok: false; status: 401 | 403 | 415; reason: string };

/** Body types a page on another site can send without a CORS preflight. JSON routes never take them. */
const SIMPLE_TYPES = ['text/plain', 'application/x-www-form-urlencoded'];

const no = (status: 401 | 403 | 415, reason: string): Decision => ({ ok: false, status, reason });

/** The credentials that may reach a shell on this machine: the install's token, or a session paired with it. */
export const mayUseShell = (c: Credential) => c === 'token' || c === 'session-token';

/** Why a shell was refused. Retry setup (runner/setup.ts) and an automation save (automation-files.ts) say the same. */
export const SHELL_REFUSAL = "a terminal, a channel action or an automation's precheck runs a shell on this machine, so it needs the install's token or a browser paired with it";

export function decideRequest(f: RequestFacts): Decision {
  if (!f.hostAllowed) return no(403, 'host not allowed');
  const site = f.fetchSite?.toLowerCase();
  if (site === 'cross-site') return no(403, 'cross-site request');
  if (site === 'same-site') return no(403, 'request from another site or port on this host');
  if (f.origin !== undefined) {
    let originHost = '';
    try {
      originHost = new URL(f.origin).host.toLowerCase();
    } catch {
      // `null` and anything else that is not a URL.
    }
    if (!f.originAllowed || !originHost || !f.hosts.map((h) => h.toLowerCase()).includes(originHost)) return no(403, 'origin not allowed');
  }
  const type = (f.contentType ?? '').split(';')[0].trim().toLowerCase();
  if (SIMPLE_TYPES.includes(type)) return no(415, 'send JSON');
  if (f.route === 'pairing') {
    // The desktop app's main process loads the link itself: a page cannot make a navigation that says none.
    if (site !== undefined && site !== 'none') return no(403, 'desktop pairing only from the desktop app');
    return f.credential === 'nonce' || f.credential === 'token' ? { ok: true } : no(403, 'desktop pairing needs a fresh nonce from the desktop app');
  }
  if (f.credential === 'none' && !f.open) return no(401, "Unauthorized: send this install's token (data/api-token), pair this browser, or sign in with Google");
  if (f.route === 'shell' && !mayUseShell(f.credential)) return no(403, SHELL_REFUSAL);
  return { ok: true };
}
