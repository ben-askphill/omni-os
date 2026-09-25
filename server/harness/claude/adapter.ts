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
import { CAPABILITIES } from '../types.ts';
import type { AdapterCallbacks, AdapterContext, HarnessAdapter, HarnessSession } from '../adapter.ts';

// A run killed before its result event may still have written the session file.
function sessionOnDisk(t: Thread) {
  const dir = join(homedir(), '.claude', 'projects', t.cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  return existsSync(join(dir, `${t.session_id}.jsonl`));
}

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
      try {
        const parsed = parseEvent(evt);
        if (parsed.usage) cb.usage(parsed.usage);
        for (const rec of parsed.records) cb.record(rec);
      } catch (err) {
        console.error(`[claude] ${thread.id} bad event:`, err);
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => splitter.push(d).forEach(handleLine));
    child.stdin.on('error', () => {});

    return {
      child,
      write(obj: unknown) {
        const stdin = child.stdin;
        if (!stdin || stdin.destroyed || stdin.writableEnded) return false;
        try {
          stdin.write(JSON.stringify(obj) + '\n');
          return true;
        } catch {
          return false;
        }
      },
      flush: () => splitter.flush().forEach(handleLine),
    };
  },
};
