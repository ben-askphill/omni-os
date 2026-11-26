// The conductor's two MCP servers for a test: apps/mcp/omni.ts as `omni` and as `omni-admin`, each its own stdio
// process, as buildMcpConfig starts them. A tool call goes to the server whose tools/list has the tool, so a test
// calls tools by name and still reaches them through the server they are on.
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const ROOT = join(import.meta.dirname, '../../..');

/** Newline-delimited JSON-RPC to one stdio MCP server. */
export class StdioMcp {
  private id = 0;
  private waiting = new Map<number, (r: any) => void>();
  constructor(readonly child: ChildProcess) {
    createInterface({ input: child.stdout! }).on('line', (line) => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      this.waiting.get(msg.id)?.(msg);
    });
  }
  request(method: string, params: unknown = {}): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 20_000);
      this.waiting.set(id, (msg) => {
        clearTimeout(timer);
        this.waiting.delete(id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      });
      this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  close() {
    this.child.kill('SIGTERM');
  }
}

type OmniServer = 'omni' | 'omni-admin';
/** How to start one, as a buildMcpConfig entry has it. */
type Entry = { command: string; args: string[]; env?: Record<string, string> };

/** Both servers, started and initialized. */
export class OmniMcp {
  private constructor(
    readonly servers: Record<OmniServer, StdioMcp>,
    /** Each server's tools as its tools/list gave them. */
    readonly listed: Record<OmniServer, { name: string; description?: string; inputSchema?: unknown }[]>,
  ) {}

  /** Both, from apps/mcp/omni.ts in this checkout, with env as their whole environment. */
  static start(env: Record<string, string>): Promise<OmniMcp> {
    const tsx = join(ROOT, 'node_modules/.bin/tsx');
    const script = join(ROOT, 'apps/mcp/omni.ts');
    return OmniMcp.launch({ omni: { command: tsx, args: [script], env }, 'omni-admin': { command: tsx, args: [script, 'admin'], env } });
  }

  /** Both, from the entries a thread's MCP config names (sandbox.ts buildMcpConfig), on top of `base`. */
  static async launch(entries: Record<OmniServer, Entry | undefined>, base: Record<string, string> = {}): Promise<OmniMcp> {
    const start = (name: OmniServer) => {
      const e = entries[name];
      if (!e) throw new Error(`the config has no ${name} server`);
      return new StdioMcp(spawn(e.command, e.args, { env: { ...base, ...e.env }, stdio: ['pipe', 'pipe', 'inherit'] }));
    };
    const servers = { omni: start('omni'), 'omni-admin': start('omni-admin') };
    const hello = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } };
    const listed = {} as OmniMcp['listed'];
    for (const [name, server] of Object.entries(servers) as [OmniServer, StdioMcp][]) {
      await server.request('initialize', hello);
      listed[name] = (await server.request('tools/list')).tools;
    }
    return new OmniMcp(servers, listed);
  }

  /** The server a tool is on. Throws for a tool neither lists. */
  serverOf(tool: string): OmniServer {
    const hit = (Object.keys(this.listed) as OmniServer[]).find((s) => this.listed[s].some((t) => t.name === tool));
    if (!hit) throw new Error(`neither omni nor omni-admin lists ${tool}`);
    return hit;
  }

  /** As one client of both: tools/call goes to the tool's server, tools/list lists both, initialize is done already. */
  request(method: string, params: any = {}): Promise<any> {
    if (method === 'initialize') return Promise.resolve({});
    if (method === 'tools/list') return Promise.resolve({ tools: [...this.listed.omni, ...this.listed['omni-admin']] });
    if (method === 'tools/call') return this.servers[this.serverOf(params.name)].request(method, params);
    return this.servers.omni.request(method, params);
  }

  close() {
    for (const server of Object.values(this.servers)) server.close();
  }
}
