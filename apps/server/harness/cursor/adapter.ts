// Cursor behind the harness adapter interface. Cursor Agent runs one process per turn
// (print mode, stream-json), so a lightweight persistent holder process stands in as the
// runner's warm "child" while the adapter spawns `cursor-agent` per turn and resumes the
// chat created up front. Omni's context goes in front of the first message of the session
// only; the transcript shows only what Ben typed. Cursor can't steer, so the runner queues
// a steer and stops the thread by killing the holder (the next message resumes the chat).
import { spawn, type ChildProcess } from 'node:child_process';
import { apiToken } from '../../api-token.ts';
import { TOOL_FAILURE_POLICY } from '../../tool-failure-policy.ts';
import { closePipesAfterExit } from '../../child.ts';
import { artifactsDir, threadDir } from '../../config.ts';
import { writeCursorPlugin } from '../../sandbox.ts';
import { describeAttachments, type Attachment } from '../../uploads.ts';
import { LineSplitter } from '../../stream.ts';
import { harnessEnv } from '../env-guard.ts';
import { spawnHolder } from '../holder.ts';
import { CAPABILITIES } from '../types.ts';
import type { AdapterCallbacks, AdapterContext, HarnessAdapter, HarnessSession } from '../adapter.ts';
import { cursorBin } from './bin.ts';
import { fromCursorTurn, type ContextUsage } from '@omni/shared/context-meter.ts';
import { cursorModelId, cursorWindow } from './models.ts';
import { CursorCallCounter, normalizeCursor } from './normalize.ts';

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
  // The thread id means no session yet: the adapter starts one and reports its id.
  freshSessionId: (thread) => thread.id,

  spawn(ctx: AdapterContext, cb: AdapterCallbacks): HarnessSession {
    const thread = ctx.thread;
    const bin = cursorBin() ?? 'cursor-agent';
    const env = harnessEnv('cursor', {
      OMNI_URL: ctx.omniUrl,
      OMNI_TOKEN: apiToken(),
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
    const holder = spawnHolder();

    let ready = false;
    let firstTurn = true;
    let stopping = false;
    let currentProc: ChildProcess | null = null;
    const outbox: Outgoing[] = [];
    // The model's name as Cursor shows it ("Auto"), and the last reading, which an estimate never drops below.
    let modelName: string | null = null;
    let lastContext: ContextUsage | null = null;

    function pump() {
      if (!ready || currentProc || !outbox.length) return;
      runTurn(outbox.shift()!);
    }

    function runTurn(m: Outgoing) {
      // A native chat may exist even if its first prompt was rejected. Include context
      // while the switched session still needs its handover, as well as on a new chat.
      const addContext = firstTurn && (!resume || ctx.handoverPending);
      const addPolicy = firstTurn && resume && !addContext;
      let prompt = m.text;
      if (m.attachments.length) prompt += `\n\n${describeAttachments(m.attachments)}`;
      if (addContext) prompt = `${ctx.systemPrompt}\n\n---\n\n${prompt}`;
      else if (addPolicy) prompt = `${TOOL_FAILURE_POLICY}\n\n---\n\n${prompt}`;

      const args = ['-p', '--output-format', 'stream-json', '--stream-partial-output', '--model', modelId, '--trust', '--force', '--sandbox', 'disabled', '--approve-mcps', '--plugin-dir', pluginDir];
      if (chatId) args.push('--resume', chatId);
      args.push(prompt);

      const proc = spawn(bin, args, { cwd: thread.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      // The runner watches the holder, not this process, so the adapter must see its exit itself.
      closePipesAfterExit(proc);
      currentProc = proc;
      let resultSeen = false;
      let accepted = false;
      let stderr = '';
      const calls = new CursorCallCounter();
      const opened = new Set<string>();

      const splitter = new LineSplitter();
      const handle = (line: string) => {
        let evt: unknown;
        try {
          evt = JSON.parse(line);
        } catch {
          return;
        }
        if (!evt || typeof evt !== 'object') return;
        // Starting a process or opening its session does not mean it accepted the
        // prompt. Cursor echoes the input once read; model output is also evidence.
        const event = evt as { type?: string; subtype?: string; is_error?: boolean };
        // With partial output enabled, Cursor sends timestamped text chunks as they
        // arrive, then repeats buffered copies before tool calls and at the end.
        // Persist only the chunks so the live transcript neither waits nor duplicates text.
        if (event.type === 'assistant' && typeof (evt as { timestamp_ms?: unknown }).timestamp_ms !== 'number') return;
        const read = event.type === 'user' || event.type === 'assistant' || event.type === 'tool_call'
          || (event.type === 'result' && event.subtype === 'success' && !event.is_error);
        if (!accepted && read) {
          accepted = true;
          firstTurn = false;
          cb.record({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
        }
        const parsed = normalizeCursor(evt);
        calls.note(parsed);
        const init = parsed.records.find((r) => r.kind === 'init');
        if (init && typeof (init.payload as { model?: unknown }).model === 'string') modelName = (init.payload as { model: string }).model || modelName;
        if (parsed.sessionId && parsed.sessionId !== chatId) {
          chatId = parsed.sessionId;
          if (chatId !== thread.session_id) cb.session(chatId);
        }
        // A call Cursor rejects up front only completes. Open it first so its result has a named call.
        if (parsed.use?.kind === 'tool_use' && !opened.has(parsed.use.payload.id)) parsed.records.unshift(parsed.use);
        for (const r of parsed.records) {
          if (r.kind === 'tool_use') opened.add(r.payload.id);
          cb.record(r);
        }
        if (parsed.result && accepted) {
          resultSeen = true;
          if (parsed.usage) {
            // Cursor's window isn't reported: it is read off the model's name, so the meter marks it an estimate.
            lastContext = fromCursorTurn(parsed.usage, calls.calls, modelName ?? thread.model ?? 'Auto', cursorWindow(thread.model ?? 'auto'), lastContext);
            cb.context?.(lastContext);
            cb.turnTokens?.(parsed.usage);
          }
          cb.record({ kind: 'result', payload: { ok: parsed.result.ok, subtype: parsed.result.ok ? 'success' : 'error', turns: 1 } });
        }
      };
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (d: string) => splitter.push(d).forEach(handle));
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (d: string) => (stderr = (stderr + d).slice(-4000)));
      proc.on('error', (e) => (stderr = e.message));
      proc.on('close', (code) => {
        splitter.flush().forEach(handle);
        if (currentProc !== proc) return;
        currentProc = null;
        // The runner is tearing the thread down (interrupt/close): it marks the turn stopped itself.
        if (stopping) return;
        if (!accepted) {
          // The runner keeps an unread message inflight until its process exits.
          // Close the holder too so it fails this turn and retries with the pending handover.
          cb.record({ kind: 'error', payload: { text: stderr.trim() || `cursor-agent exited before accepting the message with code ${code}` } });
          holder.kill('SIGKILL');
          return;
        }
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
