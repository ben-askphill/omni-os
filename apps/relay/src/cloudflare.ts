// The Cloudflare API calls Omni Connect makes (docs/adr/0009-omni-connect.md): a remotely managed tunnel per machine,
// its ingress, and a proxied CNAME under CONNECT_ZONE. One call per step: connect.ts records what each write made
// before it makes the next, and decides what it may reuse, since the account and zone can be shared by every user of
// a relay.
import { RelayError } from './auth.ts';

export interface CloudflareConfig {
  token: string;
  accountId: string;
  zoneId: string;
  /** The zone's name, like omni-os.app: hostnames are one label under it. */
  zone: string;
}

const API = 'https://api.cloudflare.com/client/v4';

type Envelope<T> = { success: boolean; result: T; errors?: { code: number; message: string }[] };

export class CloudflareApi {
  constructor(
    private readonly config: CloudflareConfig,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${API}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.config.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new RelayError(502, `Cannot reach Cloudflare (${(err as Error).message})`);
    }
    const env = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (!res.ok || !env?.success) {
      // The status always: a 404 is how nullWhenGone knows a thing is gone, whatever the error says.
      const why = [...(env?.errors?.map((e) => `${e.code}: ${e.message}`) ?? []), `HTTP ${res.status}`].join('; ');
      throw new RelayError(502, `Cloudflare refused ${method} ${path.split('?')[0]} (${why})`, 'cloudflare');
    }
    return env.result;
  }

  private get acct() {
    return `/accounts/${this.config.accountId}/cfd_tunnel`;
  }

  /** The tunnel with this id while it exists, or null once it is deleted or unknown. */
  async tunnel(id: string): Promise<{ id: string; name: string } | null> {
    const t = await this.call<{ id: string; name: string; deleted_at: string | null } | null>('GET', `${this.acct}/${id}`).catch(nullWhenGone);
    return t && !t.deleted_at ? { id: t.id, name: t.name } : null;
  }

  /** The live tunnel with exactly this name, or null. */
  async findTunnel(name: string): Promise<{ id: string } | null> {
    const found = await this.call<{ id: string; name: string }[]>('GET', `${this.acct}?name=${encodeURIComponent(name)}&is_deleted=false`);
    return found.find((t) => t.name === name) ?? null;
  }

  async createTunnel(name: string): Promise<string> {
    return (await this.call<{ id: string }>('POST', this.acct, { name, config_src: 'cloudflare' })).id;
  }

  /** The hostnames the tunnel's ingress serves. */
  async ingressHostnames(id: string): Promise<string[]> {
    const r = await this.call<{ config?: { ingress?: { hostname?: unknown }[] } | null } | null>('GET', `${this.acct}/${id}/configurations`);
    return (r?.config?.ingress ?? []).map((i) => i.hostname).filter((h): h is string => typeof h === 'string');
  }

  /** Point the tunnel's ingress at 127.0.0.1:<port> for this hostname only. */
  async configure(id: string, hostname: string, port: number) {
    await this.call('PUT', `${this.acct}/${id}/configurations`, {
      config: { ingress: [{ hostname, service: `http://127.0.0.1:${port}` }, { service: 'http_status:404' }] },
    });
  }

  private get zoneRecords() {
    return `/zones/${this.config.zoneId}/dns_records`;
  }

  async findCname(hostname: string): Promise<{ id: string; content: string } | null> {
    const [record] = await this.call<{ id: string; content: string }[]>('GET', `${this.zoneRecords}?type=CNAME&name=${encodeURIComponent(hostname)}`);
    return record ?? null;
  }

  async createCname(hostname: string, target: string): Promise<string> {
    return (await this.call<{ id: string }>('POST', this.zoneRecords, { type: 'CNAME', name: hostname, content: target, proxied: true, comment: 'Omni Connect' })).id;
  }

  async pointCname(recordId: string, target: string) {
    await this.call('PATCH', `${this.zoneRecords}/${recordId}`, { content: target, proxied: true });
  }

  /** What cloudflared runs with (TUNNEL_TOKEN). */
  connectorToken(id: string): Promise<string> {
    return this.call<string>('GET', `${this.acct}/${id}/token`);
  }

  /** Delete the DNS record and the tunnel. Already gone counts as done. */
  async remove(tunnelId: string | null, dnsRecordId: string | null) {
    if (dnsRecordId) await this.call('DELETE', `${this.zoneRecords}/${dnsRecordId}`).catch(nullWhenGone);
    if (tunnelId) await this.call('DELETE', `${this.acct}/${tunnelId}?cascade=true`).catch(nullWhenGone);
  }
}

/** Cloudflare's "no such thing" is null. Anything else, a timeout or an outage, still throws. */
function nullWhenGone(err: unknown): null {
  if (!(err instanceof RelayError) || !/HTTP 404|1003|81044|not found/i.test(err.message)) throw err;
  return null;
}

/** Where a machine's CNAME points: its tunnel. */
export const tunnelTarget = (tunnelId: string) => `${tunnelId}.cfargotunnel.com`;

/** The machine's hostname: its name as a DNS label, and 6 hex of a hash so two machines with one name differ. */
export async function hostnameFor(zone: string, user: string, machineId: string, name: string): Promise<string> {
  const slug =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'omni';
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${user}\n${machineId}`)));
  const hex = [...digest.slice(0, 3)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${slug}-${hex}.${zone}`;
}
