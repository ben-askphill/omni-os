// Cursor behind the harness adapter interface. Cursor Agent runs one process per turn
// (print mode, stream-json), so a lightweight persistent holder process stands in as the
// runner's warm "child" while the adapter spawns `cursor-agent` per turn and resumes the
// chat created up front. Omni's context goes in front of the first message of the session
// only; the transcript shows only what Ben typed. Cursor can't steer, so the runner queues
// a steer and stops the thread by killing the holder (the next message resumes the chat).
import { spawn, type ChildProcess } from 'node:child_process';
import { closePipesAfterExit } from '../../child.ts';
import { artifactsDir, threadDir } from '../../config.ts';
import { writeCursorPlugin } from '../../sandbox.ts';
import { describeAttachments, type Attachment } from '../../uploads.ts';
import { LineSplitter } from '../../stream.ts';
import { harnessEnv } from '../env-guard.ts';
import { CAPABILITIES } from '../types.ts';
import type { AdapterCallbacks, AdapterContext, HarnessAdapter, HarnessSession } from '../adapter.ts';
import { cursorBin } from './bin.ts';
import { cursorModelId } from './models.ts';
import { normalizeCursor } from './normalize.ts';

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

/** Create a Cursor chat up front and return its id. */
function createChat(bin: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ['create-chat'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    closePipesAfterExit(proc);
    let out = '';
    let err = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d: string) => (out += d));
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d: string) => (err += d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      const id = out.trim().split('\n').filter(Boolean).pop()?.trim();
      if (code === 0 && id) resolve(id);
      else reject(new Error(err.trim() || `cursor-agent create-chat exited ${code}`));
    });
  });
}

export const cursorAdapter: HarnessAdapter = {
  id: 'cursor',
  capabilities: CAPABILITIES.cursor,

  spawn(ctx: AdapterContext, cb: AdapterCallbacks): HarnessSession {
    const thread = ctx.thread;
    const bin = cursorBin() ?? 'cursor-agent';
    const env = harnessEnv('cursor', {
      OMNI_URL: ctx.omniUrl,
      OMNI_THREAD_ID: thread.id,
      OMNI_THREAD_DIR: threadDir(thread.id),
      OMNI_ARTIFACTS_DIR: artifactsDir(thread.id),
      OMNI_CHANNEL: thread.channel_id,
    }, ctx.secretEnv);
    const resume = ctx.resume || thread.session_id !== thread.id;
    let chatId: string | null = resume ? thread.session_id : null;
    const modelId = thread.model ? cursorModelId(thread.model, thread.effort || '') : 'auto';
    // Omni's MCP servers load from a per-thread plugin folder; nothing touches the repo or ~/.cursor.
    const pluginDir = writeCursorPlugin({ threadId: thread.id, channel: ctx.channel, role: ctx.role, browserBusy: ctx.browserBusy, cdpEndpoint: ctx.cdpEndpoint, omniUrl: ctx.omniUrl });

    // A persistent holder keeps the runner's warm-process logic happy between per-turn runs.
    const holder = spawn('sh', ['-c', 'exec cat >/dev/null'], { stdio: ['pipe', 'pipe', 'pipe'] });
    holder.stdin?.on('error', () => {});

    let ready = false;
    let firstTurn = true;
    let stopping = false;
    let currentProc: ChildProcess | null = null;
    const outbox: Outgoing[] = [];

    function pump() {
      if (!ready || currentProc || !outbox.length) return;
      runTurn(outbox.shift()!);
    }

    function runTurn(m: Outgoing) {
      // Omni's context goes in front of the first message of a new session only.
      const addContext = firstTurn && !resume;
      firstTurn = false;
      let prompt = m.text;
      if (m.attachments.length) prompt += `\n\n${describeAttachments(m.attachments)}`;
      if (addContext) prompt = `${ctx.systemPrompt}\n\n---\n\n${prompt}`;

      const args = ['-p', '--output-format', 'stream-json', '--model', modelId, '--trust', '--force', '--sandbox', 'disabled', '--approve-mcps', '--plugin-dir', pluginDir];
      if (chatId) args.push('--resume', chatId);
      args.push(prompt);

      const proc = spawn(bin, args, { cwd: thread.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      // The runner watches the holder, not this process, so the adapter must see its exit itself.
      closePipesAfterExit(proc);
      currentProc = proc;
      let resultSeen = false;
      let stderr = '';
      // The runner records the user message when it sees this replay.
      cb.record({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });

      const splitter = new LineSplitter();
      const handle = (line: string) => {
        let evt: unknown;
        try {
          evt = JSON.parse(line);
        } catch {
          return;
        }
        const parsed = normalizeCursor(evt);
        if (parsed.sessionId && parsed.sessionId !== chatId) {
          chatId = parsed.sessionId;
          if (chatId !== thread.session_id) cb.session(chatId);
        }
        for (const r of parsed.records) cb.record(r);
        if (parsed.result) {
          resultSeen = true;
          cb.record({ kind: 'result', payload: { ok: parsed.result.ok, subtype: parsed.result.ok ? 'success' : 'error', turns: 1 } });
        }
      };
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (d: string) => splitter.push(d).forEach(handle));
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (d: string) => (stderr = (stderr + d).slice(-4000)));
      proc.on('close', (code) => {
        splitter.flush().forEach(handle);
        if (currentProc !== proc) return;
        currentProc = null;
        // The runner is tearing the thread down (interrupt/close): it marks the turn stopped itself.
        if (stopping) return;
        if (!resultSeen) {
          // Exited without a result (crash): fail the turn with the CLI's error; next message resumes.
          cb.record({ kind: 'status', payload: { text: stderr.trim() ? stderr.trim().slice(-2000) : `cursor-agent exited with code ${code}` } });
          cb.record({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } });
        }
        pump();
      });
    }

    (async () => {
      try {
        if (!chatId) chatId = await createChat(bin, thread.cwd, env);
        if (chatId && chatId !== thread.session_id) cb.session(chatId);
        ready = true;
        pump();
      } catch {
        holder.kill('SIGKILL');
      }
    })();

    // When the runner stops or closes the holder, kill any running turn too. The runner marks the
    // turn stopped via the holder's own exit, so the killed turn must not also emit an error result.
    holder.on('exit', () => {
      stopping = true;
      if (currentProc) currentProc.kill('SIGKILL');
    });

    return {
      child: holder,
      write(obj: unknown) {
        const o = obj as { type?: string; request?: { subtype?: string }; request_id?: string };
        if (o?.type === 'user') {
          outbox.push(omniOf(o));
          pump();
          return true;
        }
        // No graceful interrupt: the runner stops Cursor by killing the holder.
        if (o?.type === 'control_request' && o.request?.subtype === 'interrupt') {
          cb.record({ kind: 'control', payload: { request_id: String(o.request_id ?? ''), subtype: 'success', still_queued: [] } });
          return true;
        }
        return true;
      },
    };
  },
};
