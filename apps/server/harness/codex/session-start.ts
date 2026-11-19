// How a Codex session starts: its process environment, the initialize handshake, and the
// thread/start or thread/resume request with the per-thread config.
import { readsOnly } from '@omni/shared/quick-ask.ts';
import { browserHeld, codexPolicy } from '../../access.ts';
import { artifactsDir, threadDir } from '../../config.ts';
import { ASK_SERVER, ASK_TIMEOUT_SEC, buildMcpConfig } from '../../sandbox.ts';
import { harnessEnv, threadTokenEnv } from '../env-guard.ts';
import type { AdapterContext } from '../adapter.ts';
import type { CodexClient } from './client.ts';
import type { ThreadStartResponse } from './protocol.ts';

/**
 * Per-thread overrides, as config.toml keys: Omni's MCP servers next to Ben's own (a dotted
 * key merges, a whole `mcp_servers` table would replace his), each with its tools approved up
 * front, a shell environment that
 * inherits everything so secrets reach the agent's shell, and ChatGPT-only login. Secret
 * values live in the process env, never in this config.
 */
export function threadConfig(mcpServers: Record<string, object>) {
  // The session runs with approvalPolicy 'never', so Codex rejects any MCP call that would ask
  // first: every tool without a readOnlyHint. These servers are Omni's own, so approve them all.
  // Codex gives an MCP call 60 seconds by default; ask_user_question waits for the user.
  const entry = (name: string, server: object) => ({
    ...server,
    default_tools_approval_mode: 'approve',
    ...(name === ASK_SERVER ? { tool_timeout_sec: ASK_TIMEOUT_SEC } : {}),
  });
  return {
    ...Object.fromEntries(Object.entries(mcpServers).map(([name, server]) => [`mcp_servers.${name}`, entry(name, server)])),
    'shell_environment_policy.inherit': 'all',
    forced_login_method: 'chatgpt',
  };
}

/** The environment the Codex process runs in: Omni's thread variables on top of the guarded base. */
export function sessionEnv(ctx: AdapterContext) {
  const thread = ctx.thread;
  return harnessEnv('codex', {
    OMNI_URL: ctx.omniUrl,
    ...threadTokenEnv(ctx),
    OMNI_THREAD_ID: thread.id,
    OMNI_THREAD_DIR: threadDir(thread.id),
    OMNI_ARTIFACTS_DIR: artifactsDir(thread.id),
    OMNI_CHANNEL: thread.channel_id,
  }, ctx.secretEnv);
}

/** Initialize the app-server. False when the process died or never answered; the runner reports its exit and stderr. */
export async function handshake(client: CodexClient): Promise<boolean> {
  try {
    await client.request('initialize', { clientInfo: { name: 'omni-os', version: '0.1.0' } });
    client.notify('initialized', {});
    return true;
  } catch {
    return false;
  }
}

/**
 * A no-edits role (the reviewer, crew.ts): Codex asks before every file patch and every command it does not know to be
 * safe ('untrusted'), and the adapter declines the patches and lets the commands run (codex/adapter.ts). So its edit
 * tool is gone and its shell stays, network and `gh` included, as on Claude Code. A read-only sandbox would also stop
 * the network, and with it `gh pr diff`. A role or quick ask that already runs read only needs none of it.
 */
export const declinesPatches = (ctx: AdapterContext) => ctx.role?.tools === 'no-edits' && !readsOnly(ctx.thread);

/** The parameters thread/start and thread/resume share. */
export function sessionParams(ctx: AdapterContext) {
  const thread = ctx.thread;
  const mcp = buildMcpConfig({
    threadId: thread.id,
    channel: ctx.channel,
    role: ctx.role,
    browserBusy: ctx.browserBusy,
    cdpEndpoint: ctx.cdpEndpoint,
    omniUrl: ctx.omniUrl,
    noBrowser: browserHeld(ctx.permission?.access),
    quick: readsOnly(thread),
  });
  const policy = ctx.permission ? codexPolicy(ctx.permission.access) : null;
  // A delegate-only role (the Conductor) reads but cannot change anything, so it hands the work off. A quick ask
  // only reads too (apps/server/quick-ask.ts). Either lock holds whatever the channel's level.
  const sandbox = ctx.role?.delegateOnly || readsOnly(thread) ? 'read-only' : (policy?.sandbox ?? 'danger-full-access');
  return {
    model: thread.model || undefined,
    cwd: thread.cwd,
    // Below full access, the channel's level (apps/server/access.ts): read only is Codex's read-only sandbox, Ask first
    // its workspace sandbox with every other action asked for and judged (codex/adapter.ts). A quick ask never asks:
    // it only reads, and needing more is what turns it into a task.
    approvalPolicy: readsOnly(thread) ? 'never' : declinesPatches(ctx) && sandbox !== 'read-only' ? 'untrusted' : (policy?.approvalPolicy ?? 'never'),
    sandbox,
    developerInstructions: ctx.systemPrompt,
    config: threadConfig(mcp.mcpServers),
  };
}

/** Resume the stored Codex thread when there is one, else start a new one. */
export function openThread(client: CodexClient, params: ReturnType<typeof sessionParams>, resumeId: string | null): Promise<ThreadStartResponse> {
  return resumeId
    ? client.request<ThreadStartResponse>('thread/resume', { threadId: resumeId, ...params })
    : client.request<ThreadStartResponse>('thread/start', params);
}
