// Claude Code's commands, as its `initialize` control request lists them.
import { spawn } from 'node:child_process';
import { isCommandName, type SlashCommand } from '../../../shared/slash.ts';
import { config } from '../../config.ts';
import { LineSplitter } from '../../stream.ts';
import { harnessEnv } from '../env-guard.ts';

/** About 1.1s for 300 commands on Ben's Mac (2026-09-27); anything near this is a wedged CLI. */
const PROBE_TIMEOUT_MS = 15_000;

// Hooks off and no session file, so listing runs nothing and leaves nothing behind. No MCP servers
// either: they only add MCP prompts, which a thread's own process lists.
const PROBE_ARGS = [
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--settings', JSON.stringify({ disableAllHooks: true }),
  '--strict-mcp-config',
  '--no-session-persistence',
];

/** Ask Claude Code which commands it has in a folder. Null when it doesn't answer. */
export function probeClaudeCommands(cwd: string): Promise<SlashCommand[] | null> {
  return new Promise((resolve) => {
    const child = spawn(config.claudeBin, PROBE_ARGS, {
      cwd,
      env: harnessEnv('claude-code', { CLAUDE_CODE_ENTRYPOINT: 'omni-os-commands' }),
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let settled = false;
    const finish = (list: SlashCommand[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve(list);
    };
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
    child.on('error', () => finish(null));
    // 'close' waits for stdout to drain, so an answer written just before exiting still counts.
    child.on('close', () => finish(null));
    child.stdin.on('error', () => {});

    const splitter = new LineSplitter();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      for (const line of splitter.push(d)) {
        let msg: { type?: string; response?: { subtype?: string; request_id?: string; response?: { commands?: unknown } } };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.type !== 'control_response' || msg.response?.request_id !== 'commands') continue;
        const commands = msg.response.subtype === 'success' ? msg.response.response?.commands : undefined;
        finish(Array.isArray(commands) ? normalizeClaudeCommands(commands) : null);
      }
    });
    child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'commands', request: { subtype: 'initialize' } }) + '\n');
  });
}

interface RawCommand {
  name?: unknown;
  description?: unknown;
  argumentHint?: unknown;
  builtin?: unknown;
  aliases?: unknown;
}

// Claude Code ends a description with the command's scope: `(user)`, `(claude.ai sync)` or `(project)`.
const SCOPE = /\s*\((user|claude\.ai sync|project)\)\s*$/;

// Claude Code lists an MCP prompt as "server:prompt (MCP)" and runs it as /mcp__server__prompt, with _ for
// anything in the server name but letters, digits, _ and - (claude 2.1.282). The server name can hold colons.
const MCP_PROMPT = /^(.+):([^:]+) \(MCP\)$/;
const mcpName = (server: string, prompt: string) => `mcp__${server.replace(/[^A-Za-z0-9_-]/g, '_')}__${prompt}`;

/** Turn Claude Code's raw command list into the menu's shape. */
export function normalizeClaudeCommands(raw: unknown): SlashCommand[] {
  if (!Array.isArray(raw)) return [];
  const out: SlashCommand[] = [];
  for (const r of raw as RawCommand[]) {
    const name = typeof r?.name === 'string' ? r.name : '';
    let description = typeof r?.description === 'string' ? r.description.replace(/\s+/g, ' ').trim() : '';
    const mcp = MCP_PROMPT.exec(name);
    if (mcp) {
      // Its arguments follow the name, split at spaces, but it can't be a Mention.
      const runs = mcpName(mcp[1], mcp[2]);
      if (isCommandName(runs)) out.push({ name: runs, description, source: 'mcp', mentionable: false });
      continue;
    }
    // Internal commands can't be typed after a `/`.
    if (!isCommandName(name)) continue;
    const argumentHint = typeof r.argumentHint === 'string' && r.argumentHint.trim() ? r.argumentHint.trim() : undefined;
    const aliases = Array.isArray(r.aliases) ? r.aliases.filter((a): a is string => typeof a === 'string' && isCommandName(a)) : [];

    const cmd: SlashCommand = { name, description, source: 'builtin', mentionable: true };
    const colon = name.indexOf(':');
    const plugin = colon > 0 ? name.slice(0, colon) : '';
    const scope = SCOPE.exec(description)?.[1];
    if (r.builtin === true) {
      cmd.mentionable = false;
    } else if (plugin && description.startsWith(`(${plugin})`)) {
      cmd.source = 'plugin';
      cmd.plugin = plugin;
      description = description.slice(plugin.length + 2).trim();
    } else if (scope) {
      cmd.source = scope === 'project' ? 'project' : 'personal';
      description = description.replace(SCOPE, '');
    }
    // Anything else untagged is a skill Claude Code bundles, which can still be a Mention.
    cmd.description = description;
    if (argumentHint) cmd.argumentHint = argumentHint;
    if (aliases.length) cmd.aliases = aliases;
    out.push(cmd);
  }
  return out;
}
