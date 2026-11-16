import { MCP_CLIENT_ID, mcpClients, type McpClientSync } from '../../mcp-clients.ts';
import { registerHandler } from '../apply.ts';

// The OAuth clients that reached /mcp on any machine (mcp-clients.ts), by client id. Not last writer wins: first and last
// seen widen, and Ben's newest approve or remove decides, so a client merely seen on one machine never undoes a
// decision made on another. A signed action (sync/verify.ts): it applies only from a trusted machine, so no relay
// writer can approve a client. Nothing deletes a row; removing a client is a decision like approving one.

const time = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

registerHandler('mcp_client', {
  serialize(id) {
    return mcpClients.syncData(id);
  },
  apply(change) {
    if (change.op !== 'upsert' || !MCP_CLIENT_ID.test(change.entity_id)) return false;
    const d = (change.data ?? {}) as Record<string, unknown>;
    const firstSeen = time(d.firstSeen);
    const lastSeen = time(d.lastSeen);
    const decision = d.decision === 'approved' || d.decision === 'removed' ? d.decision : null;
    if (!firstSeen || !lastSeen || (d.decision != null && !decision)) return false;
    // A decision is no newer than the change that carries it, so a skewed clock cannot make one outlast every later one.
    const at = time(d.decidedAt);
    const decidedAt = decision && at ? (at > change.ts ? change.ts : at) : null;
    const remote: McpClientSync = { decision, decidedAt, firstSeen, lastSeen };
    return mcpClients.applyRemote(change.entity_id, remote);
  },
});
