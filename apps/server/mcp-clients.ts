// The OAuth clients that reached /mcp with a Clerk JWT for the owner (mcp-token.ts). A client whose token names this
// install's /mcp resource is listed as 'bound' and only such tokens get in; one whose token does not waits as 'pending'
// until Ben approves it. Removing a client refuses its tokens from then on, even ones bound to the resource.
// Machine-local: never synced.
//
// /api/mcp/clients lists them, POST /:id/approve approves one, DELETE /:id removes one.
import { Hono } from 'hono';
import { db, now } from './db/connection.ts';
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

type Row = { id: string; status: ClientStatus; via: 'audience' | 'client' | null; first_seen: string; last_seen: string };
const toClient = (r: Row): McpClient => ({ id: r.id, name: null, status: r.status, firstSeen: r.first_seen, lastSeen: r.last_seen, via: r.via });

/** Client ids approved in the config file (`integrations.mcpClients`, comma separated). */
const configured = () =>
  resolved
    .mcpClients()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const mcpClients = {
  list: (): McpClient[] => (db.prepare('SELECT * FROM mcp_clients ORDER BY last_seen DESC').all() as Row[]).map(toClient),
  get: (id: string): McpClient | null => {
    const r = db.prepare('SELECT * FROM mcp_clients WHERE id = ?').get(id) as Row | undefined;
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
    db.prepare(
      `INSERT INTO mcp_clients (id, status, via, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen,
         via = COALESCE(excluded.via, mcp_clients.via),
         status = CASE WHEN mcp_clients.status IN ('removed', 'approved') THEN mcp_clients.status
                       WHEN excluded.status = 'bound' THEN 'bound' ELSE mcp_clients.status END`,
    ).run(id, status, via, at, at);
  },
  approve: (id: string): McpClient => {
    const at = now();
    db.prepare(
      `INSERT INTO mcp_clients (id, status, via, first_seen, last_seen) VALUES (?, 'approved', NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = 'approved'`,
    ).run(id, at, at);
    return mcpClients.get(id)!;
  },
  remove: (id: string) => {
    const at = now();
    db.prepare(
      `INSERT INTO mcp_clients (id, status, via, first_seen, last_seen) VALUES (?, 'removed', NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = 'removed'`,
    ).run(id, at, at);
  },
};

const ID = /^[\w.-]{1,200}$/;

export const mcpClientsApi = new Hono();

mcpClientsApi.get('/', (c) => c.json(mcpClients.list()));

mcpClientsApi.post('/:id/approve', (c) => {
  const id = c.req.param('id');
  if (!ID.test(id)) return c.json({ error: 'bad client id' }, 400);
  return c.json(mcpClients.approve(id));
});

mcpClientsApi.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!ID.test(id)) return c.json({ error: 'bad client id' }, 400);
  mcpClients.remove(id);
  return c.json({ ok: true });
});
