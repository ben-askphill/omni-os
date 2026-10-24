// Cursor Cloud behind the harness adapter interface: each thread is one Cursor cloud agent, launched through the
// Cloud Agents API on the channel's GitHub repo, and each message is a run on it. Like Hermes it has no local CLI, so
// a holder process stands in as the runner's child. The first message carries Omni's context; later ones go as
// follow-up runs. The run is read every few seconds for its status, branch and PR, and its final reply ends the turn.
// The agent keeps going when Omni quits; only Stop cancels its run. The key never reaches a process environment.
import { readFileSync } from 'node:fs';
import { config } from '../../config.ts';
import { userName } from '../../profile.ts';
import type { Attachment } from '../../uploads.ts';
import type { CloudAgentState } from '../../stream.ts';
import { CURSOR_CLOUD_FIX, CURSOR_CLOUD_NO_REPO, CURSOR_CLOUD_REJECTED, CURSOR_CLOUD_UNREACHABLE } from '../catalog.ts';
import { harnessEnv } from '../env-guard.ts';
import { spawnHolder } from '../holder.ts';
import { CAPABILITIES } from '../types.ts';
import type { AdapterCallbacks, AdapterContext, HarnessAdapter, HarnessSession } from '../adapter.ts';
import { CursorCloudClient, CursorCloudError, type CursorImage, type CursorRun } from './client.ts';
import { TERMINAL, agentUrl, changed, endRecords, stateOf, statusText } from './normalize.ts';

interface Outgoing {
  text: string;
  uuid: string;
  attachments: Attachment[];
}

const omniOf = (obj: any): Outgoing => ({
  text: String(obj?._omni?.text ?? ''),
  uuid: String(obj?.uuid ?? ''),
  attachments: (obj?._omni?.attachments ?? []) as Attachment[],
});

/** What the API takes as an image: up to five PNG, JPEG, GIF or WebP files of 15 MB or less. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
/** Polls in a row that may fail (a dropped connection, Cursor down) before the turn gives up on the run. */
const MAX_POLL_FAILURES = 30;

/** The prompt: Ben's text, images that fit the API's limits, and a note for files that stay on the Mac. */
function composePrompt(m: Outgoing): { text: string; images?: CursorImage[] } {
  const images: CursorImage[] = [];
  const left: Attachment[] = [];
  for (const a of m.attachments) {
    if (a.image && IMAGE_TYPES.has(a.mime) && a.size <= MAX_IMAGE_BYTES && images.length < MAX_IMAGES) {
      try {
        images.push({ data: readFileSync(a.path).toString('base64'), mimeType: a.mime });
        continue;
      } catch {
        // Unreadable: described below instead.
      }
    }
    left.push(a);
  }
  const lines = [m.text];
  if (left.length) {
    lines.push('', '## Attachments', `${userName()} attached files on their Mac. They were not sent to this machine, so you cannot read them.`);
    for (const a of left) lines.push(`- ${a.name} (${a.mime}, ${Math.max(1, Math.round(a.size / 1024))} KB), not sent`);
  }
  return { text: lines.join('\n'), ...(images.length && { images }) };
}

/** Cursor's own message where it explains the failure, never the key. */
function failText(e: unknown, apiKey: string, repo: string): string {
  const clean = (s: string) => (apiKey ? s.split(apiKey).join('[key]') : s);
  if (e instanceof LostRun) return `Lost touch with the Cursor API while the agent ran. It may still be working: ${e.url}`;
  if (!(e instanceof CursorCloudError)) return CURSOR_CLOUD_UNREACHABLE;
  if (e.status === 401) return CURSOR_CLOUD_REJECTED;
  if (e.code === 'repository_access' || e.code === 'integration_not_connected' || e.code === 'repository_required') {
    return `Cursor can't open ${repo} on GitHub. Connect GitHub on cursor.com/dashboard and give Cursor access to the repo.${e.message ? ` (${clean(e.message)})` : ''}`;
  }
  if (e.code === 'agent_archived') return 'This cloud agent is archived on cursor.com. Unarchive it there, or start a new thread.';
  if (e.code === 'agent_not_found') return 'This cloud agent no longer exists on cursor.com. Start a new thread.';
  return `The Cursor API refused the run (HTTP ${e.status}${e.code ? `, ${e.code}` : ''})${e.message ? `: ${clean(e.message)}` : '.'}`;
}

class LostRun extends Error {
  constructor(readonly url: string) {
    super('lost the run');
  }
}

/** A thread's agent id is fixed up front, so a create that is sent again can't make a second agent. */
export const agentIdOf = (thread: { id: string; session_id: string }) => (thread.session_id.startsWith('bc-') ? thread.session_id : `bc-${thread.id}`);

export const cursorCloudAdapter: HarnessAdapter = {
  id: 'cursor-cloud',
  capabilities: CAPABILITIES['cursor-cloud'],
  // The thread id means no agent yet: agentIdOf makes it bc-<thread id>. A run switch never moves a thread here anyway.
  freshSessionId: (thread) => thread.id,

  spawn(ctx: AdapterContext, cb: AdapterCallbacks): HarnessSession {
    const thread = ctx.thread;
    const repo = ctx.channel.github_repo ?? '';
    const apiKey = ctx.secretEnv.CURSOR_API_KEY ?? '';
    const agentId = agentIdOf(thread);
    // The session id becomes the agent id once the agent exists, so a resumed thread follows up on it.
    let created = thread.session_id === agentId;

    // The key is an HTTP header, never an env var: strip it even when the shell exported it.
    const holder = spawnHolder(harnessEnv('cursor-cloud', {}));

    const outbox: Outgoing[] = [];
    let holderDead = false;
    let turnActive = false;
    let turnAbort: AbortController | null = null;
    /** The run this turn follows, for Stop. */
    let activeRun: string | null = null;
    let stopRequested = false;
    let wake: (() => void) | null = null;
    /** What the agent itself says about where it runs, once created. */
    let agentInfo: Pick<CloudAgentState, 'url' | 'name' | 'ref'> = { url: agentUrl({ id: agentId, url: '' }), ...(thread.title && { name: thread.title.slice(0, 100) }) };
    /** The last state shown in the transcript. */
    let state: CloudAgentState | null = null;
    const client = new CursorCloudClient(apiKey, config.cursorApiUrl);

    const base = (): CloudAgentState => ({ ...(state ?? { agent_id: agentId, repo, status: 'CREATING' }), ...agentInfo });

    function show(next: CloudAgentState) {
      const was = state;
      if (!changed(was, next)) return;
      state = next;
      cb.record({ kind: 'cloud_agent', payload: next });
      if (!TERMINAL.has(next.status) && was?.status !== next.status) cb.record({ kind: 'status', payload: { text: statusText(next.status) } });
    }

    /** Wait for the next poll, or less when Stop wants the cancelled run read back now. */
    const nap = (ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
        const t = setTimeout(done, ms);
        function done() {
          clearTimeout(t);
          wake = null;
          signal.removeEventListener('abort', abort);
          resolve();
        }
        function abort() {
          clearTimeout(t);
          wake = null;
          reject(new DOMException('aborted', 'AbortError'));
        }
        wake = done;
        signal.addEventListener('abort', abort, { once: true });
      });

    /** Read the run until it ends, showing each move. Returns it ended. */
    async function follow(first: CursorRun, ac: AbortController): Promise<CursorRun> {
      let run = first;
      activeRun = run.id;
      show(stateOf(base(), run));
      if (stopRequested) await cancel();
      let failures = 0;
      while (!TERMINAL.has(run.status)) {
        await nap(config.cursorCloudPollMs, ac.signal);
        try {
          run = await client.getRun(agentId, run.id, ac.signal);
          failures = 0;
        } catch (e) {
          if (ac.signal.aborted) throw e;
          if (e instanceof CursorCloudError && (e.status === 401 || e.status === 403 || e.status === 404)) throw e;
          if (++failures >= MAX_POLL_FAILURES) throw new LostRun(base().url);
          continue;
        }
        show(stateOf(base(), run));
      }
      return run;
    }

    /**
     * Send a message to an agent that exists. One that is still busy with an earlier run (Omni quit while it ran)
     * finishes that run first: its reply shows here, then this message goes.
     */
    async function followUp(prompt: { text: string; images?: CursorImage[] }, ac: AbortController): Promise<CursorRun | null> {
      try {
        return (await client.createRun(agentId, prompt, ac.signal)).run;
      } catch (e) {
        if (!(e instanceof CursorCloudError && e.code === 'agent_busy')) throw e;
      }
      const agent = await client.getAgent(agentId, ac.signal);
      if (agent.latestRunId) {
        cb.record({ kind: 'status', payload: { text: "Waiting for the agent's earlier run to finish" } });
        const earlier = await follow(await client.getRun(agentId, agent.latestRunId, ac.signal), ac);
        if (earlier.result?.trim()) cb.record({ kind: 'assistant_text', payload: { text: earlier.result.trim() } });
        // Stopped while it waited: this message never goes.
        if (stopRequested) return null;
      }
      return (await client.createRun(agentId, prompt, ac.signal)).run;
    }

    async function cancel() {
      const run = activeRun;
      if (!run) return;
      try {
        await client.cancelRun(agentId, run);
      } catch {
        // 409: it already ended. The next read shows how.
      }
      wake?.();
    }

    /** One per turn, as a CLI does: the runner shows the first and reads each as a turn having begun. */
    function init() {
      cb.record({ kind: 'init', payload: { model: thread.model || 'default', cwd: '', tools: 0, mcp: [] } });
    }

    function pump() {
      if (turnActive || holderDead || !outbox.length) return;
      runTurn(outbox.shift()!);
    }

    function runTurn(m: Outgoing) {
      turnActive = true;
      stopRequested = false;
      init();
      // The runner moves the message into the transcript when it sees this.
      cb.record({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
      const ac = new AbortController();
      turnAbort = ac;

      void (async () => {
        try {
          const prompt = composePrompt(m);
          let run: CursorRun | null;
          if (!created) {
            const first = { ...prompt, text: ctx.systemPrompt ? `${ctx.systemPrompt}\n\n---\n\n${prompt.text}` : prompt.text };
            try {
              const res = await client.createAgent(
                {
                  agentId,
                  prompt: first,
                  repos: [{ url: `https://github.com/${repo}` }],
                  autoCreatePR: true,
                  ...(thread.title && { name: thread.title.slice(0, 100) }),
                  ...(thread.model && thread.model !== 'default' && { model: { id: thread.model } }),
                },
                ac.signal,
              );
              created = true;
              cb.session(res.agent.id);
              agentInfo = {
                url: agentUrl(res.agent),
                ...((res.agent.name || agentInfo.name) && { name: res.agent.name || agentInfo.name }),
                ...(res.agent.repos?.[0]?.startingRef && { ref: res.agent.repos[0].startingRef }),
              };
              run = res.run;
            } catch (e) {
              // Made by an earlier try whose answer never came back: it exists, so this goes as a follow-up.
              if (!(e instanceof CursorCloudError && e.code === 'agent_id_conflict')) throw e;
              created = true;
              cb.session(agentId);
              run = await followUp(prompt, ac);
            }
          } else {
            run = await followUp(prompt, ac);
          }
          if (holderDead) return;
          if (!run) {
            cb.record({ kind: 'result', payload: { ok: false, subtype: 'cancelled', turns: 1 } });
            return;
          }
          const ended = await follow(run, ac);
          for (const rec of endRecords(state ?? stateOf(base(), ended), ended)) cb.record(rec);
        } catch (e) {
          if (holderDead || ac.signal.aborted) return;
          cb.record({ kind: 'error', payload: { text: failText(e, apiKey, repo) } });
          cb.record({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } });
        } finally {
          if (turnAbort === ac) turnAbort = null;
          activeRun = null;
          turnActive = false;
          if (!holderDead) pump();
        }
      })();
    }

    holder.on('exit', (_code, signal) => {
      holderDead = true;
      const run = activeRun;
      turnAbort?.abort();
      // SIGINT is the runner's hard stop: Ben wants the run stopped. Quitting Omni or closing an idle thread ends
      // stdin instead, and leaves the agent working on Cursor's machines.
      if (signal === 'SIGINT' && run) void client.cancelRun(agentId, run).catch(() => {});
    });

    const refuse = (text: string) => ({
      child: holder,
      write(obj: unknown) {
        if ((obj as { type?: string })?.type === 'user') {
          const m = omniOf(obj);
          cb.record({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
          cb.record({ kind: 'error', payload: { text } });
          cb.record({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } });
          holder.kill('SIGTERM');
        }
        return !!holder.stdin && !holder.stdin.destroyed;
      },
    });
    if (!repo) return refuse(`Cursor Cloud is not available in this channel. ${CURSOR_CLOUD_NO_REPO}.`);
    if (!apiKey) return refuse(`Cursor Cloud is not available. ${CURSOR_CLOUD_FIX}.`);

    return {
      child: holder,
      write(obj: unknown) {
        if (holderDead || !holder.stdin || holder.stdin.destroyed) return false;
        const o = obj as { type?: string; request?: { subtype?: string }; request_id?: string };
        if (o?.type === 'user') {
          // Cursor Cloud can't steer, so the runner only writes between turns. A message that still lands mid-run waits.
          outbox.push(omniOf(obj));
          pump();
          return true;
        }
        if (o?.type === 'control_request' && o.request?.subtype === 'interrupt') {
          // Ack now so the runner's grace timer doesn't kill the holder while the cancel goes out.
          cb.record({ kind: 'control', payload: { request_id: String(o.request_id ?? ''), subtype: 'success', still_queued: [] } });
          if (!turnActive) return true;
          stopRequested = true;
          void cancel();
          return true;
        }
        return true;
      },
    };
  },
};
