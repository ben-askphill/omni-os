import { MCP_CLIENT_ID, mcpClients } from '../../mcp-clients.ts';
import { registerHandler } from '../apply.ts';

// The OAuth clients that reached /mcp on any machine (mcp-clients.ts), by client id. Not last writer wins: first and last
// seen widen, and Ben's newest approve or remove decides, so a client merely seen on one machine never undoes a
// decision made on another. A signed action (sync/verify.ts): it applies only from a trusted machine, so no relay
// writer can approve a client. Nothing deletes a row; removing a client is a decision like approving one.
//
// A decision keeps the date its machine gave it, even one in the future from a clock that runs ahead. Capping it here
// would store a different date on each machine, and a skewed machine would keep its own: Ben's later removal elsewhere
// would lose there, and its next send would win again. Instead a decision made here is dated after the one it replaces
// (mcp-clients.ts decide), so it wins on every machine whatever their clocks say.
//
// A date more than a week ahead of this machine's clock comes from a clock that is broken, not skewed. Its approval
// never applies here: no client gets in on a date this machine cannot believe, and the client is listed as it was
// (pending when new). Its removal does, dated at that limit. Either way its date is kept apart, so Ben's next decision
// here is dated after it and also wins on the machine with the broken clock.

const HORIZON_MS = 7 * 86_400_000;

/** An ISO time with a four-digit year, the form every machine writes and reads. Null for anything else. */
const time = (v: unknown): string | null => {
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) return null;
  const iso = new Date(v).toISOString();
  return /^\d{4}-/.test(iso) ? iso : null;
};

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
    const decidedAt = decision ? time(d.decidedAt) : null;
    if (decision && d.decidedAt != null && !decidedAt) return false;
    const id = change.entity_id;
    const limit = Date.now() + HORIZON_MS;
    if (!decidedAt || Date.parse(decidedAt) <= limit) return mcpClients.applyRemote(id, { decision, decidedAt, firstSeen, lastSeen });
    const sent = decidedAt;
    let changed: boolean;
    if (decision === 'approved') {
      console.warn(`[sync] not approving MCP client ${id}: ${change.machine_id} dated it ${sent}, over a week ahead of this clock`);
      changed = mcpClients.applyRemote(id, { decision: null, decidedAt: null, firstSeen, lastSeen });
    } else changed = mcpClients.applyRemote(id, { decision, decidedAt: new Date(limit).toISOString(), firstSeen, lastSeen });
    return mcpClients.noteFutureDecision(id, sent) || changed;
  },
});
