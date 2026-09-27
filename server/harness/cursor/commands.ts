// Cursor Agent's commands and skills, as its ACP server lists them for a folder. Cursor Agent
// finds a `/name` in a print-mode prompt itself, so Omni only lists them.
import { spawn } from 'node:child_process';
import { readdirSync, rmdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isCommandName, type CommandSource, type SlashCommand } from '../../../shared/slash.ts';
import { LineSplitter } from '../../stream.ts';
import { harnessEnv } from '../env-guard.ts';
import { cursorBin } from './bin.ts';

/** 4 to 7s for 140 commands on Ben's Mac (2026-09-27); anything near this is a wedged CLI. */
const PROBE_TIMEOUT_MS = 20_000;

/**
 * Ask Cursor Agent which commands it has in a folder, through `cursor-agent acp`: initialize, a
 * session for the folder with no MCP servers, then the list it sends for that session. Null when
 * it doesn't answer.
 */
export function probeCursorCommands(cwd: string): Promise<SlashCommand[] | null> {
  const bin = cursorBin();
  if (!bin) return Promise.resolve(null);
  const env = harnessEnv('cursor', {});
  return new Promise((resolve) => {
    const child = spawn(bin, ['acp'], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });
    let list: SlashCommand[] | null = null;
    let sessionId: string | null = null;
    let done = false;
    let settled = false;
    const finish = (found: SlashCommand[] | null) => {
      if (done) return;
      done = true;
      list = found;
      clearTimeout(timer);
      child.kill('SIGKILL');
    };
    // Answer once Cursor Agent is gone, so removing its session can't race it.
    const settle = () => {
      if (settled) return;
      settled = true;
      finish(null);
      if (sessionId) forgetSession(env, sessionId);
      resolve(list);
    };
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
    child.on('error', settle);
    child.on('close', settle);
    child.stdin.on('error', () => {});
    const send = (msg: object) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

    const splitter = new LineSplitter();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      for (const line of splitter.push(d)) {
        let msg: { id?: number; method?: string; result?: { sessionId?: unknown }; error?: unknown; params?: any };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.method) {
          const update = msg.params?.update;
          if (msg.method === 'session/update' && update?.sessionUpdate === 'available_commands_update') {
            if (typeof msg.params.sessionId === 'string') sessionId ??= msg.params.sessionId;
            finish(Array.isArray(update.availableCommands) ? normalizeCursorCommands(update.availableCommands) : null);
          } else if (msg.id !== undefined) {
            // Cursor Agent asking the client for something: listing needs none of it.
            send({ id: msg.id, error: { code: -32601, message: 'Not supported' } });
          }
        } else if (msg.error) {
          finish(null);
        } else if (msg.id === 1) {
          send({ id: 2, method: 'session/new', params: { cwd, mcpServers: [] } });
        } else if (msg.id === 2 && typeof msg.result?.sessionId === 'string') {
          sessionId = msg.result.sessionId;
        }
      }
    });
    send({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientInfo: { name: 'omni-os-commands', version: '0.1.0' },
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      },
    });
  });
}

/** Where Cursor Agent keeps its state, found the way it finds it. */
function cursorConfigDir(env: NodeJS.ProcessEnv): string {
  if (env.CURSOR_CONFIG_DIR?.trim()) return env.CURSOR_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME?.trim()) return join(env.XDG_CONFIG_HOME, 'cursor');
  return join(homedir(), '.cursor');
}

/**
 * Remove the session a probe opened. Cursor Agent keeps each ACP session in its own folder; one
 * that never got a prompt holds only meta.json, and anything more is left alone.
 */
function forgetSession(env: NodeJS.ProcessEnv, sessionId: string) {
  if (!/^[A-Za-z0-9-]+$/.test(sessionId)) return;
  const dir = join(cursorConfigDir(env), 'acp-sessions', sessionId);
  try {
    if (readdirSync(dir).join('/') !== 'meta.json') return;
    rmSync(join(dir, 'meta.json'));
    rmdirSync(dir);
  } catch {
    // Already gone, or never written.
  }
}

// Built-ins that only make sense in Cursor Agent's own terminal.
const TERMINAL_ONLY = new Set(['copy-request-id', 'rename-chat', 'statusline']);

// Cursor Agent ends a description with the entry's scope. Commands someone wrote and every skill
// can be Mentions; Cursor's own `(global)` and untagged commands can't.
const SCOPE = /\s*\((user skill|project skill|builtin skill|skill|user|project|team|global)\)\s*$/;
const SCOPE_SOURCE: Record<string, { source: CommandSource; mentionable: boolean }> = {
  user: { source: 'personal', mentionable: true },
  'user skill': { source: 'personal', mentionable: true },
  project: { source: 'project', mentionable: true },
  'project skill': { source: 'project', mentionable: true },
  'builtin skill': { source: 'builtin', mentionable: true },
  skill: { source: 'builtin', mentionable: true },
  team: { source: 'builtin', mentionable: true },
  global: { source: 'builtin', mentionable: false },
};
const UNTAGGED = { source: 'builtin' as const, mentionable: false };

/** Turn one `available_commands_update` list into the menu's shape. */
export function normalizeCursorCommands(raw: unknown): SlashCommand[] {
  if (!Array.isArray(raw)) return [];
  const out: SlashCommand[] = [];
  const seen = new Set<string>();
  for (const c of raw as { name?: unknown; description?: unknown }[]) {
    const name = typeof c?.name === 'string' ? c.name : '';
    if (!isCommandName(name) || TERMINAL_ONLY.has(name) || seen.has(name)) continue;
    seen.add(name);
    const text = typeof c.description === 'string' ? c.description.replace(/\s+/g, ' ').trim() : '';
    const scope = SCOPE.exec(text)?.[1];
    let description = text.replace(SCOPE, '');
    // Cursor describes a command by its file's first line, which is the fence when it has frontmatter.
    if (/^-+$/.test(description)) description = '';
    out.push({ name, description, ...(scope ? SCOPE_SOURCE[scope] : UNTAGGED) });
  }
  return out;
}
