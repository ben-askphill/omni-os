// Omni Connect in one user's Durable Object (docs/adr/0009-omni-connect.md): the machines with a tunnel, the relay's
// own signing key, and the Connect page's sessions. Plain over the Sql interface, like store.ts, so the tests run it
// on node:sqlite with a fake Cloudflare and a fake machine.
import { RelayError, sha256 } from './auth.ts';
import { CloudflareApi, hostnameFor, tunnelTarget } from './cloudflare.ts';
import { KeyLock } from './objects.ts';
import {
  HEALTH_REQUEST,
  HEALTH_RESPONSE,
  MINT_REQUEST,
  MINT_RESPONSE,
  newKeyPair,
  publicJwk,
  randomHex,
  REGISTER_PROOF,
  RELAY_ISSUER,
  sign,
  thumbprint,
  verify,
  type EcJwk,
} from './jwt.ts';
import type { Sql } from './store.ts';

export interface Machine {
  id: string;
  name: string;
  hostname: string;
  createdAt: string;
  updatedAt: string;
}

export interface MachineStatus extends Machine {
  online: boolean;
  /** Set when the machine answered but its answer did not check out. */
  problem: string | null;
}

/** The relay token a registration comes with, as the Durable Object knows it. */
export interface Caller {
  /** The token's id (store.ts). */
  tokenId: string;
  /** sha256 hex of the bearer token: what a REGISTER_PROOF names. */
  tokenHash: string;
  /** The sync machine the token pushes as (store.ts bindMachine), or null before its first push. */
  machine: string | null;
}

export interface Registered {
  hostname: string;
  connectorToken: string;
  /** The key the machine pins: only requests it signs mint a code. */
  relayKey: EcJwk;
}

type Row = {
  id: string;
  name: string;
  public_key: string;
  hostname: string;
  port: number;
  tunnel_id: string | null;
  /** The tunnel's name as this relay gave it, or null for a row an earlier relay wrote (see ownTunnel). */
  tunnel_name: string | null;
  dns_record_id: string | null;
  token_id: string;
  /** 0 while a first registration is still provisioning: not listed, not opened. */
  ready: number;
  created_at: string;
  updated_at: string;
};

/** A request to a machine waits this long. */
const MACHINE_TIMEOUT_MS = 5_000;
/** A mint or health request is good for this long. */
const REQUEST_TTL_S = 60;
/** How long a Connect page sign-in lasts. */
export const CLIENT_DAYS = 30;
const MACHINE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A REGISTER_PROOF may live at most this long. */
const PROOF_MAX_S = 120;
const SKEW_S = 60;
const JKT = /^[A-Za-z0-9_-]{43}$/;

export const notConfigured = () =>
  new RelayError(503, 'Omni Connect is not set up on this relay: set CF_API_TOKEN, CF_ACCOUNT_ID, CF_ZONE_ID and CONNECT_ZONE (npm run relay:config prints how)', 'connect_not_configured');

export class ConnectStore {
  constructor(
    private readonly sql: Sql,
    /** Null when the Worker has no Cloudflare secrets: Connect is off, sync still works. */
    private readonly cf: CloudflareApi | null,
    private readonly zone: string | null,
    private readonly user: string,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = Date.now,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS connect_machines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      public_key TEXT NOT NULL,
      hostname TEXT NOT NULL UNIQUE,
      port INTEGER NOT NULL,
      tunnel_id TEXT,
      tunnel_name TEXT,
      dns_record_id TEXT,
      token_id TEXT NOT NULL,
      ready INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    // Rows from before tunnel names carried the user: no tunnel_name (checked once, see ownTunnel), and ready.
    const cols = (sql.exec('PRAGMA table_info(connect_machines)').toArray() as { name: string }[]).map((c) => c.name);
    if (!cols.includes('tunnel_name')) sql.exec('ALTER TABLE connect_machines ADD COLUMN tunnel_name TEXT');
    if (!cols.includes('ready')) sql.exec('ALTER TABLE connect_machines ADD COLUMN ready INTEGER NOT NULL DEFAULT 1');
    sql.exec('CREATE TABLE IF NOT EXISTS connect_key (id INTEGER PRIMARY KEY CHECK (id = 1), private_jwk TEXT NOT NULL, public_jwk TEXT NOT NULL)');
    sql.exec(`CREATE TABLE IF NOT EXISTS connect_clients (
      id TEXT PRIMARY KEY,
      hash TEXT NOT NULL UNIQUE,
      email TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`);
  }

  /** One registration or removal per machine id at a time: Cloudflare calls await, and other requests run meanwhile. */
  private readonly lock = new KeyLock();

  private iso = () => new Date(this.now()).toISOString();

  private async key(): Promise<{ privateJwk: JsonWebKey; publicJwk: EcJwk }> {
    const [row] = this.sql.exec('SELECT private_jwk, public_jwk FROM connect_key WHERE id = 1').toArray() as { private_jwk: string; public_jwk: string }[];
    if (row && publicJwk(JSON.parse(row.public_jwk))) return { privateJwk: JSON.parse(row.private_jwk), publicJwk: JSON.parse(row.public_jwk) };
    const pair = await newKeyPair();
    if (!pair.publicJwk) throw new RelayError(500, 'The relay could not make its Connect key');
    // A row stored without a usable public key (an earlier build) is replaced, not kept.
    this.sql.exec('DELETE FROM connect_key WHERE id = 1');
    // A Durable Object runs one request at a time, and nothing awaits between this read and write's caller.
    this.sql.exec('INSERT OR IGNORE INTO connect_key (id, private_jwk, public_jwk) VALUES (1, ?, ?)', JSON.stringify(pair.privateJwk), JSON.stringify(pair.publicJwk));
    return this.key();
  }

  private row(id: string): Row | null {
    return (this.sql.exec('SELECT * FROM connect_machines WHERE id = ?', id).toArray()[0] as Row | undefined) ?? null;
  }

  private machine(r: Row): Machine {
    return { id: r.id, name: r.name, hostname: r.hostname, createdAt: r.created_at, updatedAt: r.updated_at };
  }

  // ---------- machines (relay token) ----------

  /**
   * Turn Connect on for a machine, or repair it: the same hostname every time. A registered id belongs to the token
   * that registered it. Another token gets it only with a REGISTER_PROOF signed by the key the machine enrolled: the
   * same machine, signed in again. A new id is claimed in this object before any Cloudflare call, and nothing on
   * Cloudflare is reused unless this object recorded it (see provision).
   */
  async register(body: unknown, caller: Caller): Promise<Registered> {
    if (!this.cf || !this.zone) throw notConfigured();
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const id = typeof b.machineId === 'string' ? b.machineId : '';
    if (!MACHINE_ID.test(id)) throw new RelayError(400, 'machineId: 1 to 64 letters, digits, - or _');
    const name = (typeof b.name === 'string' ? b.name.trim() : '').slice(0, 100) || 'Omni';
    const key = publicJwk(b.publicKey);
    if (!key) throw new RelayError(400, 'publicKey: a P-256 public JWK');
    const port = Number(b.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RelayError(400, 'port: 1 to 65535');
    if (caller.machine !== null && caller.machine !== id)
      throw new RelayError(403, `This relay token belongs to machine ${caller.machine}, so it cannot register ${id}`, 'not_this_machine');
    const proof = typeof b.proof === 'string' ? b.proof : null;

    return this.lock.run(id, async () => {
      let r = this.row(id);
      if (r && r.token_id !== caller.tokenId && !(await this.proves(r, proof, key, caller)))
        throw new RelayError(
          403,
          `${r.name} (${id}) is on Omni Connect under another relay sign-in. Only that machine can register it again, signed with the key it enrolled (update Omni on it if this is that machine)`,
          'not_this_machine',
        );
      const fresh = !r;
      if (!r) r = await this.claim(id, name, key, port, caller.tokenId);
      const progress = { wrote: false };
      try {
        const { tunnelId, connectorToken } = await this.provision(r, port, progress);
        this.sql.exec(
          'UPDATE connect_machines SET name = ?, public_key = ?, port = ?, tunnel_id = ?, token_id = ?, ready = 1, updated_at = ? WHERE id = ?',
          name,
          JSON.stringify(key),
          port,
          tunnelId,
          caller.tokenId,
          this.iso(),
          id,
        );
        return { hostname: r.hostname, connectorToken, relayKey: (await this.key()).publicJwk };
      } catch (err) {
        // A first registration that changed nothing on Cloudflare gives the id and hostname back. One that did stays,
        // not ready, so the next try finishes it with what it recorded, or turning Connect off deletes it.
        if (fresh && !progress.wrote) this.sql.exec('DELETE FROM connect_machines WHERE id = ? AND ready = 0', id);
        throw err;
      }
    });
  }

  /** Whether `proof` is a fresh REGISTER_PROOF from the machine behind row `r`, for this token, user and key. */
  private async proves(r: Row, proof: string | null, key: EcJwk, caller: Caller): Promise<boolean> {
    if (!proof) return false;
    const claims = await verify(proof, JSON.parse(r.public_key) as EcJwk, REGISTER_PROOF, this.now());
    if (!claims) return false;
    const now = this.now() / 1000;
    const { iss, aud, sub, tkh, jkt, iat, exp } = claims;
    if (typeof iat !== 'number' || typeof exp !== 'number' || iat > now + SKEW_S || exp - iat > PROOF_MAX_S) return false;
    return iss === r.id && aud === RELAY_ISSUER && sub === this.user && tkh === caller.tokenHash && jkt === (await thumbprint(key));
  }

  /**
   * Take a new id, and its hostname, before any Cloudflare call. Nothing awaits between the check and the insert, so
   * no other request in this object can take either in between; the table's keys refuse a duplicate besides.
   */
  private async claim(id: string, name: string, key: EcJwk, port: number, tokenId: string): Promise<Row> {
    const hostname = await hostnameFor(this.zone!, this.user, id, name);
    const tunnelName = await this.newTunnelName(id);
    if (this.row(id)) throw new RelayError(409, `${id} is being registered by another request`, 'not_this_machine');
    if (this.sql.exec('SELECT id FROM connect_machines WHERE hostname = ?', hostname).toArray().length)
      throw new RelayError(409, `${hostname} is another machine's Omni Connect hostname. Rename this machine and try again`, 'hostname_taken');
    const at = this.iso();
    this.sql.exec(
      `INSERT INTO connect_machines (id, name, public_key, hostname, port, tunnel_id, tunnel_name, dns_record_id, token_id, ready, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, 0, ?, ?)`,
      id,
      name,
      JSON.stringify(key),
      hostname,
      port,
      tunnelName,
      tokenId,
      at,
      at,
    );
    return this.row(id)!;
  }

  /**
   * The tunnel name for a new tunnel: the user's tag, so two users of one Cloudflare account never share a name, the
   * machine id, and random hex recorded before the tunnel exists, so a tunnel found by that name is the one this
   * object made.
   */
  private async newTunnelName(id: string) {
    return `omni-${(await sha256(`omni-connect-tenant\n${this.user}`)).slice(0, 12)}-${id}-${randomHex(4)}`;
  }

  /**
   * Make or repair the row's tunnel, its ingress to 127.0.0.1:<port> and its DNS record. Each id a write makes is
   * recorded before the next call, and a Cloudflare object is reused only on that record: the DNS record by its id or
   * a CNAME to this row's tunnel, the tunnel by its id and the name this object gave it.
   */
  private async provision(r: Row, port: number, progress: { wrote: boolean }): Promise<{ tunnelId: string; connectorToken: string }> {
    const cf = this.cf!;
    const record = await cf.findCname(r.hostname);
    if (record && record.id !== r.dns_record_id && !(r.tunnel_id && record.content === tunnelTarget(r.tunnel_id)))
      throw new RelayError(409, `${r.hostname} already points at a tunnel this relay did not make for ${r.name}`, 'hostname_taken');

    let tunnelId = await this.ownTunnel(r);
    if (!tunnelId) {
      // The recorded tunnel is gone or not provably this row's: name a new one before making it.
      if (r.tunnel_id || !r.tunnel_name) {
        r.tunnel_name = await this.newTunnelName(r.id);
        r.tunnel_id = null;
        this.sql.exec('UPDATE connect_machines SET tunnel_id = NULL, tunnel_name = ? WHERE id = ?', r.tunnel_name, r.id);
      }
      // An earlier try may have made it and stopped before recording its id.
      tunnelId = (await cf.findTunnel(r.tunnel_name))?.id ?? null;
      if (!tunnelId) {
        progress.wrote = true;
        tunnelId = await cf.createTunnel(r.tunnel_name);
      }
      r.tunnel_id = tunnelId;
      this.sql.exec('UPDATE connect_machines SET tunnel_id = ? WHERE id = ?', tunnelId, r.id);
    }

    progress.wrote = true;
    await cf.configure(tunnelId, r.hostname, port);
    const target = tunnelTarget(tunnelId);
    let dnsRecordId: string;
    if (record) {
      dnsRecordId = record.id;
      if (record.content !== target) await cf.pointCname(record.id, target);
    } else {
      // The recorded record is gone. Forget its id first: a create whose answer is lost then leaves no id, and removal
      // finds the new CNAME by its target.
      if (r.dns_record_id) {
        r.dns_record_id = null;
        this.sql.exec('UPDATE connect_machines SET dns_record_id = NULL WHERE id = ?', r.id);
      }
      dnsRecordId = await cf.createCname(r.hostname, target);
    }
    r.dns_record_id = dnsRecordId;
    this.sql.exec('UPDATE connect_machines SET dns_record_id = ? WHERE id = ?', dnsRecordId, r.id);
    return { tunnelId, connectorToken: await cf.connectorToken(tunnelId) };
  }

  /**
   * The row's recorded tunnel while it exists and is provably the row's, else null. A tunnel this relay named carries
   * that name. A row an earlier relay wrote recorded the id of a tunnel named omni-<id>, a name any user of the account
   * could have had; it is adopted once, when the tunnel's ingress serves this row's hostname, and its name recorded.
   */
  private async ownTunnel(r: Row): Promise<string | null> {
    if (!r.tunnel_id) return null;
    const t = await this.cf!.tunnel(r.tunnel_id);
    if (!t) return null;
    if (r.tunnel_name) return t.name === r.tunnel_name ? t.id : null;
    if (t.name !== `omni-${r.id}` || !(await this.cf!.ingressHostnames(t.id)).includes(r.hostname)) return null;
    r.tunnel_name = t.name;
    this.sql.exec('UPDATE connect_machines SET tunnel_name = ? WHERE id = ?', t.name, r.id);
    return t.id;
  }

  /** Delete the machine's tunnel, DNS record and row. With a token id, only the machine that token registered. */
  async remove(id: string, tokenId?: string) {
    await this.lock.run(id, async () => {
      const r = this.row(id);
      if (!r) return;
      if (tokenId !== undefined && r.token_id !== tokenId) throw new RelayError(403, 'Only that machine can turn its Omni Connect off', 'not_this_machine');
      if (this.cf) {
        // A row an earlier relay wrote deletes its tunnel only when it passes the adoption check. A first registration
        // that stopped after making its tunnel recorded the name, not yet the id.
        const tunnelId = !r.tunnel_name
          ? await this.ownTunnel(r)
          : (r.tunnel_id ?? (await this.cf.findTunnel(r.tunnel_name))?.id ?? null);
        // One that lost the answer to its DNS create has a CNAME to its tunnel and no record id.
        let dnsRecordId = r.dns_record_id;
        if (!dnsRecordId && tunnelId) {
          const record = await this.cf.findCname(r.hostname);
          if (record?.content === tunnelTarget(tunnelId)) dnsRecordId = record.id;
        }
        await this.cf.remove(tunnelId, dnsRecordId);
      }
      this.sql.exec('DELETE FROM connect_machines WHERE id = ?', id);
    });
  }

  /**
   * A machine that signs out of the relay loses its tunnel too. Best effort: Cloudflare may be down. The token is
   * checked again under the lock: the machine may have registered again under a new token meanwhile.
   */
  async removeForToken(tokenId: string) {
    const rows = this.sql.exec('SELECT id FROM connect_machines WHERE token_id = ?', tokenId).toArray() as { id: string }[];
    for (const { id } of rows)
      await this.remove(id, tokenId).catch((err) => {
        if (!(err instanceof RelayError && err.code === 'not_this_machine')) console.warn(`[connect] could not remove ${id}: ${(err as Error).message}`);
      });
  }

  list(): Machine[] {
    return (this.sql.exec('SELECT * FROM connect_machines WHERE ready = 1 ORDER BY name, id').toArray() as Row[]).map((r) => this.machine(r));
  }

  /** Every machine, with whether its Omni answered a signed health request through its tunnel. */
  async listWithStatus(): Promise<MachineStatus[]> {
    const rows = this.sql.exec('SELECT * FROM connect_machines WHERE ready = 1 ORDER BY name, id').toArray() as Row[];
    return Promise.all(
      rows.map(async (r) => {
        try {
          await this.ask(r, 'health', HEALTH_REQUEST, {});
          return { ...this.machine(r), online: true, problem: null };
        } catch (err) {
          const problem = err instanceof RelayError && err.code === 'machine_untrusted' ? err.message : null;
          return { ...this.machine(r), online: false, problem };
        }
      }),
    );
  }

  /** Ask a machine to mint a one-time code bound to the browser key `jkt`. Returns where to send the browser. */
  async open(id: string, jkt: string): Promise<{ url: string; hostname: string }> {
    if (!JKT.test(jkt)) throw new RelayError(400, 'jkt: a key thumbprint');
    const r = this.row(id);
    if (!r || !r.ready) throw new RelayError(404, 'No such machine on Omni Connect');
    const claims = await this.ask(r, 'mint', MINT_REQUEST, { jkt });
    if (claims.jkt !== jkt || typeof claims.code !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(claims.code))
      throw new RelayError(502, `${r.name} answered with a code for another key`, 'machine_untrusted');
    return { hostname: r.hostname, url: `https://${r.hostname}/#/connect?code=${encodeURIComponent(claims.code)}` };
  }

  /**
   * POST a signed request to the machine through its tunnel and check its signed answer: signed by the key it
   * registered, naming the relay and this request's nonce. A different process behind the hostname cannot answer.
   */
  private async ask(r: Row, path: 'mint' | 'health', typ: string, extra: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { privateJwk } = await this.key();
    const nonce = randomHex(16);
    const iat = Math.floor(this.now() / 1000);
    const request = await sign(privateJwk, typ, { iss: RELAY_ISSUER, aud: r.id, sub: this.user, nonce, jti: randomHex(16), iat, exp: iat + REQUEST_TTL_S, ...extra });
    let res: Response;
    try {
      res = await this.fetchImpl(`https://${r.hostname}/api/connect/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request }),
        // A redirect would leave the machine's hostname.
        redirect: 'manual',
        signal: AbortSignal.timeout(MACHINE_TIMEOUT_MS),
      });
    } catch (err) {
      throw new RelayError(504, `${r.name} is offline (${(err as Error).message})`, 'machine_offline');
    }
    const body = (await res.json().catch(() => null)) as { response?: unknown; error?: unknown } | null;
    if (!res.ok) {
      const why = typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`;
      const offline = res.status >= 500 || res.status === 404;
      throw new RelayError(offline ? 504 : 502, `${r.name} ${offline ? 'is offline' : 'refused'}: ${why}`, offline ? 'machine_offline' : 'machine_refused');
    }
    const claims = typeof body?.response === 'string' ? await verify(body.response, JSON.parse(r.public_key) as EcJwk, path === 'mint' ? MINT_RESPONSE : HEALTH_RESPONSE, this.now()) : null;
    if (!claims || claims.iss !== r.id || claims.aud !== RELAY_ISSUER || claims.nonce !== nonce)
      throw new RelayError(502, `The answer from ${r.hostname} is not signed by ${r.name}`, 'machine_untrusted');
    return claims;
  }

  // ---------- Connect page sessions ----------

  async addClient(token: string, email: string | null) {
    const at = this.now();
    this.sql.exec(
      'INSERT INTO connect_clients (id, hash, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      crypto.randomUUID(),
      await sha256(token),
      email,
      new Date(at).toISOString(),
      new Date(at + CLIENT_DAYS * 86_400_000).toISOString(),
    );
    this.sql.exec('DELETE FROM connect_clients WHERE expires_at < ?', new Date(at).toISOString());
  }

  /** The signed-in email (or null) while the session is live. Throws RelayError(401, signed_out) otherwise. */
  async checkClient(token: string): Promise<{ email: string | null }> {
    const [row] = this.sql.exec('SELECT email, expires_at FROM connect_clients WHERE hash = ?', await sha256(token)).toArray() as { email: string | null; expires_at: string }[];
    if (!row || Date.parse(row.expires_at) < this.now()) throw new RelayError(401, 'Sign in to Omni Connect', 'signed_out');
    return { email: row.email };
  }

  async removeClient(token: string) {
    this.sql.exec('DELETE FROM connect_clients WHERE hash = ?', await sha256(token));
  }
}
