// Claude Code behind the harness adapter interface. This is the runner's original
// process handling, moved here unchanged: the same args, the same env (with the API
// auth vars stripped), the same stream-json parsing.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { config, artifactsDir, threadDir } from '../../config.ts';
import type { Thread } from '../../db.ts';
import { parseEvent, LineSplitter } from '../../stream.ts';
import { harnessEnv } from '../env-guard.ts';
import { normalizeClaudeCommands } from './commands.ts';
import { fromClaudeContext, type ContextUsage } from '../../../shared/context-meter.ts';
import { CAPABILITIES } from '../types.ts';
import type { AdapterCallbacks, AdapterContext, HarnessAdapter, HarnessSession } from '../adapter.ts';

/** Omni's own `initialize` request, whose answer lists the process's commands. */
const COMMANDS_REQUEST = 'omni-commands';
/** Omni's `get_context_usage` requests: the CLI's split of the context window. Costs no tokens. */
const CONTEXT_REQUEST = 'omni-context';

/** The answer to one of Omni's context requests, or null for any other event. */
function contextAnswer(evt: any): ContextUsage | null {
  if (evt?.type !== 'control_response') return null;
  const r = evt.response;
  if (typeof r?.request_id !== 'string' || !r.request_id.startsWith(CONTEXT_REQUEST) || r.subtype !== 'success') return null;
  return fromClaudeContext(r.response);
}

/**
 * A command list the process sent: its answer to Omni's `initialize`, or the whole list again once it
 * changed. MCP prompts only arrive the second way, when the servers connect after the answer went out.
 */
function listedCommands(evt: any): unknown[] | null {
  const list =
    evt?.type === 'control_response' && evt.response?.request_id === COMMANDS_REQUEST && evt.response.subtype === 'success'
      ? evt.response.response?.commands
      : evt?.type === 'system' && evt.subtype === 'commands_changed'
        ? evt.commands
        : null;
  return Array.isArray(list) ? list : null;
}

/** Where the CLI keeps a thread's session: one JSON line per message. */
export const sessionFile = (t: Pick<Thread, 'cwd' | 'session_id'>) =>
  join(homedir(), '.claude', 'projects', t.cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${t.session_id}.jsonl`);

// A run killed before its result event may still have written the session file.
const sessionOnDisk = (t: Thread) => existsSync(sessionFile(t));

export const claudeAdapter: HarnessAdapter = {
  id: 'claude-code',
  capabilities: CAPABILITIES['claude-code'],
  resumeOnDisk: sessionOnDisk,

  spawn(ctx: AdapterContext, cb: AdapterCallbacks): HarnessSession {
    const { thread, mcpFile, secretEnv, systemPrompt } = ctx;
    const resume = ctx.resume || sessionOnDisk(thread);

    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--replay-user-messages',
      '--model', thread.model || ctx.role?.model || config.defaultModel,
      '--permission-mode', config.permissionMode,
      '--add-dir', threadDir(thread.id),
      '--append-system-prompt', systemPrompt,
    ];
    if (thread.effort) args.push('--effort', thread.effort);
    if (thread.cwd !== config.brainDir) args.push('--add-dir', config.brainDir);
    if (mcpFile) args.push('--mcp-config', mcpFile);
    args.push(resume ? '--resume' : '--session-id', thread.session_id);

    const child = spawn(config.claudeBin, args, {
      cwd: thread.cwd,
      env: harnessEnv('claude-code', {
        CLAUDE_CODE_ENTRYPOINT: 'omni-os',
        CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
        OMNI_URL: ctx.omniUrl,
        OMNI_THREAD_ID: thread.id,
        OMNI_THREAD_DIR: threadDir(thread.id),
        OMNI_ARTIFACTS_DIR: artifactsDir(thread.id),
        OMNI_CHANNEL: thread.channel_id,
      }, secretEnv),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const splitter = new LineSplitter();
    const handleLine = (line: string) => {
      let evt: unknown;
      try {
        evt = JSON.parse(line);
      } catch {
        return;
      }
      const listed = listedCommands(evt);
      if (listed) cb.commands?.(normalizeClaudeCommands(listed));
      const context = contextAnswer(evt);
      if (context) return cb.context?.(context);
      try {
        const parsed = parseEvent(evt);
        if (parsed.usage) cb.usage(parsed.usage);
        if (parsed.context) cb.contextHint?.(parsed.context);
        for (const rec of parsed.records) cb.record(rec);
      } catch (err) {
        console.error(`[claude] ${thread.id} bad event:`, err);
      }
      // Every turn ends with a fresh split of the window, for the meter.
      if ((evt as { type?: string }).type === 'result') requestContext();
    };

    let contextRequests = 0;
    const requestContext = () => {
      const stdin = child.stdin;
      if (!stdin || stdin.destroyed || stdin.writableEnded) return false;
      try {
        stdin.write(JSON.stringify({ type: 'control_request', request_id: `${CONTEXT_REQUEST}-${++contextRequests}`, request: { subtype: 'get_context_usage' } }) + '\n');
        return true;
      } catch {
        return false;
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => splitter.push(d).forEach(handleLine));
    child.stdin.on('error', () => {});
    // Ahead of the first message: the commands this process can run, for the thread's `/` menu.
    child.stdin.write(JSON.stringify({ type: 'control_request', request_id: COMMANDS_REQUEST, request: { subtype: 'initialize' } }) + '\n');

    return {
      child,
      write(obj: unknown) {
        const stdin = child.stdin;
        if (!stdin || stdin.destroyed || stdin.writableEnded) return false;
        // Drop the Omni side channel; Claude only sees the standard stream-json user line.
        const { _omni, ...clean } = (obj ?? {}) as Record<string, unknown>;
        void _omni;
        try {
          stdin.write(JSON.stringify(clean) + '\n');
          return true;
        } catch {
          return false;
        }
      },
      flush: () => splitter.flush().forEach(handleLine),
      requestContext,
    };
  },
};
