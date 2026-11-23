// Omni's per-thread MCP servers for a local harness (sandbox.ts buildMcpConfig), read from what its spawn has. Each
// adapter shapes them for its own CLI: Claude Code's --mcp-config file (writeMcpConfig), Codex's thread config
// (codex/session-start.ts) and Cursor Agent's plugin folder (writeCursorPlugin). A remote harness gets none.
import { readsOnly } from '@omni/shared/quick-ask.ts';
import type { McpInput } from '../sandbox.ts';
import type { AdapterContext } from './adapter.ts';

/**
 * `noBrowser`: the harness cannot ask before each MCP call and the browser is below full access here (access.ts
 * browserHeld), so it goes without one. Claude Code asks per call, so it keeps it.
 */
export function mcpInput(ctx: AdapterContext, opts: { noBrowser?: boolean } = {}): McpInput {
  return {
    threadId: ctx.thread.id,
    channel: ctx.channel,
    role: ctx.role,
    browserBusy: ctx.browserBusy,
    cdpEndpoint: ctx.cdpEndpoint,
    omniUrl: ctx.omniUrl,
    quick: readsOnly(ctx.thread),
    leadsTeam: ctx.leadsTeam,
    ...(opts.noBrowser && { noBrowser: true }),
  };
}
