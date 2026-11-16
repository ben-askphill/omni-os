// The OAuth clients that reached /mcp with a Clerk JWT for the owner (mcp-token.ts). A client whose token names this
// install's /mcp resource is listed as 'bound' and only such tokens get in; one whose token does not waits as 'pending'
// until Ben approves it. Removing a client refuses its tokens from then on, even ones bound to the resource.
//
// Synced (sync/handlers/mcp-client.ts), so every machine lists the same clients and Ben decides once for all of them.
// What travels is his decision (approved or removed, and when) and when the client was first and last seen: no token,
// no secret. Bound and pending describe what this machine's /mcp saw, so they stay here. A client only another machine
// saw arrives as pending, and the newest decision wins on every machine, a removal over an approval made at the same time.
//
// /api/mcp/clients lists them, POST /:id/approve approves one, DELETE /:id removes one.
import { Hono } from 'hono';
import { db, now, tx } from './db/connection.ts';
import { record } from './db/sync.ts';
import type { ClientStatus } from './mcp-token.ts';
import { resolved } from './user-config.ts';

export interface McpClient {
  id: string;
  /** Not known from a token; kept in the shape so a later Clerk lookup can fill it. */
  name: string | null;
  status: ClientStatus;
  firstSeen: string;
  lastSeen: string;
  /** How its last accepted token was bound: its audience named this install, or Ben approved the client. */
  via: 'audience' | 'client' | null;
}

type Decision = 'approved' | 'removed';

/** A client as the other machines get it. */
export interface McpClientSync {
  /** Ben's last decision on any machine, or null while he has made none. */
  decision: Decision | null;
  /** When he made it. Null for an approval from before sync, which any dated decision beats (db/migrate.ts). */
  decidedAt: string | null;
  firstSeen: string;
  lastSeen: string;
}

type Row = { id: string; status: ClientStatus; via: 'audience' | 'client' | null; first_seen: string; last_seen: string; decided_at: string | null };
const toClient = (r: Row): McpClient => ({ id: r.id, name: null, status: r.status, firstSeen: r.first_seen, lastSeen: r.last_seen, via: r.via });
const row = (id: string) => db.prepare('SELECT * FROM mcp_clients WHERE id = ?').get(id) as Row | undefined;
const isDecision = (s: unknown): s is Decision => s === 'approved' || s === 'removed';

/** A client id, as the routes and the sync handler take it. */
export const MCP_CLIENT_ID = /^[\w.-]{1,200}$/;

/** Each /mcp request marks its client seen. Its last_seen goes out once per ten-minute slot ('2026-11-16T11:5'), not every time. */
const slot = (ts: string) => ts.slice(0, 15);

/** Client ids approved in the config file (`integrations.mcpClients`, comma separated). */
const configured = () =>
  resolved
    .mcpClients()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** A decision's time as a number, so no date format sorts wrongly as text. Undated (from before sync) is oldest. */
const ms = (t: string | null) => (t ? Date.parse(t) : -Infinity);

/** The last moment with a four-digit year: a decision is never dated later, so every machine can read its date. */
export const LAST_DATE = Date.parse('9999-12-31T23:59:59.999Z');

/** Whether a decision made at `at` replaces one made at `hereAt`. Same time: a removal wins, the safer of the two. */
const replaces = (decision: Decision, at: string | null, here: Decision, hereAt: string | null) =>
  ms(at) > ms(hereAt) || (ms(at) === ms(hereAt) && decision === 'removed' && here !== 'removed');

export const mcpClients = {
  list: (): McpClient[] => (db.prepare('SELECT * FROM mcp_clients ORDER BY last_seen DESC').all() as Row[]).map(toClient),
  get: (id: string): McpClient | null => {
    const r = row(id);
    return r ? toClient(r) : null;
  },
  /** Removed wins over the config file, so Ben can cut off a configured client without editing it. */
  status: (id: string): ClientStatus | null => {
    const r = db.prepare('SELECT status FROM mcp_clients WHERE id = ?').get(id) as { status: ClientStatus } | undefined;
    if (r?.status === 'removed') return 'removed';
    if (configured().includes(id)) return 'approved';
    return r?.status ?? null;
  },
  /**
   * A token from this client was accepted (`via`) or refused for want of approval (null). A new client is 'bound' when
   * its token named this install, else 'pending'. Only approve() makes a client 'approved': an audience match lets
   * that one token in and never vouches for the client's other tokens.
   */
  seen: (id: string, via: 'audience' | 'client' | null) => {
    const at = now();
    const status: ClientStatus = via === 'audience' ? 'bound' : 'pending';
    tx(() => {
      const before = db.prepare('SELECT last_seen FROM mcp_clients WHERE id = ?').get(id) as { last_seen: string } | undefined;
      db.prepare(
        `INSERT INTO mcp_clients (id, status, via, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen,
           via = COALESCE(excluded.via, mcp_clients.via),
           status = CASE WHEN mcp_clients.status IN ('removed', 'approved') THEN mcp_clients.status
                         WHEN excluded.status = 'bound' THEN 'bound' ELSE mcp_clients.status END`,
      ).run(id, status, via, at, at);
      if (!before || slot(before.last_seen) !== slot(at)) record('mcp_client', id);
    });
  },
  approve: (id: string): McpClient => {
    decide(id, 'approved');
    return mcpClients.get(id)!;
  },
  remove: (id: string) => decide(id, 'removed'),
  /** The change data for a client, for sync. Null when there is no such row. */
  syncData: (id: string): McpClientSync | null => {
    const r = row(id);
    if (!r) return null;
    const decision = isDecision(r.status) ? r.status : null;
    return { decision, decidedAt: decision ? r.decided_at : null, firstSeen: r.first_seen, lastSeen: r.last_seen };
  },
  /**
   * Take a client another machine sent: first and last seen widen to cover both, and its decision replaces the one
   * here when it is newer. Without a decision a new client is pending; bound and via stay as this machine saw them.
   * Plain SQL that records nothing, so it never echoes back. True when the row changed.
   */
  applyRemote: (id: string, d: McpClientSync): boolean => {
    const r = row(id);
    const takes = !!d.decision && (!r || !isDecision(r.status) || replaces(d.decision, d.decidedAt, r.status, r.decided_at));
    if (!r) {
      db.prepare('INSERT INTO mcp_clients (id, status, via, first_seen, last_seen, decided_at) VALUES (?, ?, NULL, ?, ?, ?)').run(
        id,
        takes ? d.decision! : 'pending',
        d.firstSeen,
        d.lastSeen,
        takes ? d.decidedAt : null,
      );
      return true;
    }
    const first = d.firstSeen < r.first_seen ? d.firstSeen : r.first_seen;
    const last = d.lastSeen > r.last_seen ? d.lastSeen : r.last_seen;
    const status = takes ? d.decision! : r.status;
    const decidedAt = takes ? d.decidedAt : r.decided_at;
    if (first === r.first_seen && last === r.last_seen && status === r.status && decidedAt === r.decided_at) return false;
    db.prepare('UPDATE mcp_clients SET first_seen = ?, last_seen = ?, status = ?, decided_at = ? WHERE id = ?').run(first, last, status, decidedAt, id);
    return true;
  },
};

/**
 * Ben approved or removed a client here. It goes to the other machines, where it wins over any older decision. It is
 * dated after the decision it replaces, even one from a machine whose clock runs ahead, so it wins there too.
 */
function decide(id: string, decision: Decision) {
  tx(() => {
    const before = row(id)?.decided_at;
    const at = new Date(Math.min(LAST_DATE, Math.max(Date.now(), before ? Date.parse(before) + 1 : 0))).toISOString();
    db.prepare(
      `INSERT INTO mcp_clients (id, status, via, first_seen, last_seen, decided_at) VALUES (?, ?, NULL, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, decided_at = excluded.decided_at`,
    ).run(id, decision, at, at, at);
    record('mcp_client', id);
  });
}

export const mcpClientsApi = new Hono();

mcpClientsApi.get('/', (c) => c.json(mcpClients.list()));

mcpClientsApi.post('/:id/approve', (c) => {
  const id = c.req.param('id');
  if (!MCP_CLIENT_ID.test(id)) return c.json({ error: 'bad client id' }, 400);
  return c.json(mcpClients.approve(id));
});

mcpClientsApi.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!MCP_CLIENT_ID.test(id)) return c.json({ error: 'bad client id' }, 400);
  mcpClients.remove(id);
  return c.json({ ok: true });
});
