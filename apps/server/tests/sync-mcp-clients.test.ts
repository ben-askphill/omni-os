import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport, type Change } from '../sync/transport.ts';
import { unsigned } from '../sync/signing.ts';
import { signAs } from './sync-sign.ts';

// The MCP clients list between two Macs in one process, each with its own data dir, through one in-memory relay: a
// client that reached /mcp on one shows on the other, and Ben's approve or remove on either holds on both. Syncing
// never approves a client by itself, carries no token, and takes a decision only from a trusted machine.

async function machine(name: string) {
  vi.resetModules();
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), `omni-sync-${name}-`));
  const db = await import('../db.ts');
  const { mcpClients, mcpClientsApi } = await import('../mcp-clients.ts');
  const sync = await import('../sync/worker.ts');
  const verify = await import('../sync/verify.ts');
  const before = name === 'mac-a' ? seedBeforeArm(mcpClients) : null;
  const worker = sync.createSyncWorker({ transport: relay, machineId: name });
  const card = async () => (await (await mcpClientsApi.request('/')).json()) as { id: string; status: string; firstSeen: string; lastSeen: string }[];
  return { name, db, mcpClients, worker, verify, card, before };
}

/** A client A's /mcp had seen before sync was set up there, which the first arm queues. */
function seedBeforeArm(clients: typeof import('../mcp-clients.ts').mcpClients) {
  clients.seen('claude-ai', 'audience');
  return clients.get('claude-ai')!;
}

const relay = new MemoryTransport();
let a: Awaited<ReturnType<typeof machine>>;
let b: Awaited<ReturnType<typeof machine>>;

async function exchange() {
  for (const m of [a, b, a]) expect((await m.worker.syncNow()).error).toBeUndefined();
}

const statusOn = (m: typeof a, id: string) => m.mcpClients.get(id)?.status;
const tick = () => new Promise((r) => setTimeout(r, 5));

beforeAll(async () => {
  a = await machine('mac-a');
  b = await machine('mac-b');
  await exchange();
});

describe('MCP clients across machines', () => {
  it('a client A saw before sync was set up shows on B, pending there, with the same times', async () => {
    const [onB] = await b.card();
    expect(onB).toMatchObject({ id: 'claude-ai', firstSeen: a.before!.firstSeen, lastSeen: a.before!.lastSeen });
    // Bound means its token named A's /mcp. B's /mcp never let it in, so B shows it waiting for approval.
    expect(a.mcpClients.status('claude-ai')).toBe('bound');
    expect(b.mcpClients.status('claude-ai')).toBe('pending');
  });

  it('a client refused on A shows on B as pending, never approved', async () => {
    a.mcpClients.seen('grok-bot', null);
    await exchange();
    expect(statusOn(b, 'grok-bot')).toBe('pending');
    expect((await b.card()).map((c) => c.id).sort()).toEqual(['claude-ai', 'grok-bot']);
  });

  it('approving on B approves on A, so its tokens get in by client id there', async () => {
    const res = await b.mcpClients.approve('grok-bot');
    expect(res.status).toBe('approved');
    await exchange();
    expect(a.mcpClients.status('grok-bot')).toBe('approved');
    expect(b.mcpClients.status('grok-bot')).toBe('approved');
  });

  it('A seeing the client again before it hears of an approval does not undo it', async () => {
    a.mcpClients.seen('chatgpt', null);
    await exchange();
    await tick();
    b.mcpClients.approve('chatgpt');
    await tick();
    // A refuses another token from it, a write newer than B's approval, before the next sync.
    a.db.db.prepare(`UPDATE mcp_clients SET last_seen = '2000-01-01T00:00:00.000Z' WHERE id = 'chatgpt'`).run();
    a.mcpClients.seen('chatgpt', null);
    await exchange();
    expect(statusOn(a, 'chatgpt')).toBe('approved');
    expect(statusOn(b, 'chatgpt')).toBe('approved');
    expect(b.mcpClients.get('chatgpt')!.lastSeen).toBe(a.mcpClients.get('chatgpt')!.lastSeen);
  });

  it('removing on A removes on B, and it drops off the card there', async () => {
    a.mcpClients.remove('grok-bot');
    await exchange();
    expect(b.mcpClients.status('grok-bot')).toBe('removed');
    // A removed client's tokens are refused even when they name the install, so a later token there keeps it removed.
    b.mcpClients.seen('grok-bot', 'audience');
    expect(b.mcpClients.status('grok-bot')).toBe('removed');
  });

  it('approving it again on B brings it back on A', async () => {
    await tick();
    b.mcpClients.approve('grok-bot');
    await exchange();
    expect(statusOn(a, 'grok-bot')).toBe('approved');
  });

  it('two decisions made apart before a sync: the newer one wins on both', async () => {
    a.mcpClients.seen('perplexity', null);
    await exchange();
    a.mcpClients.approve('perplexity');
    await tick();
    b.mcpClients.remove('perplexity');
    await exchange();
    expect([statusOn(a, 'perplexity'), statusOn(b, 'perplexity')]).toEqual(['removed', 'removed']);

    await tick();
    b.mcpClients.approve('perplexity');
    await tick();
    a.mcpClients.remove('perplexity');
    await tick();
    a.mcpClients.approve('perplexity');
    await exchange();
    expect([statusOn(a, 'perplexity'), statusOn(b, 'perplexity')]).toEqual(['approved', 'approved']);
  });

  it('sends the decision and the times, never a token, a via or a bound status', async () => {
    const sent = relay.changes.filter((c) => c.entity === 'mcp_client');
    expect(sent.length).toBeGreaterThan(0);
    for (const c of sent) {
      const data = unsigned(c).change.data as Record<string, unknown>;
      expect(Object.keys(data).sort()).toEqual(['decidedAt', 'decision', 'firstSeen', 'lastSeen']);
      expect([null, 'approved', 'removed']).toContain(data.decision);
    }
  });

  it('queues a client once per ten minutes of /mcp requests, not on each one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2030-01-01T10:00:00.000Z'));
      const queued = () => (a.db.db.prepare(`SELECT COUNT(*) AS n FROM sync_outbox WHERE entity = 'mcp_client' AND entity_id = 'busy'`).get() as { n: number }).n;
      a.mcpClients.seen('busy', 'audience');
      vi.setSystemTime(new Date('2030-01-01T10:04:00.000Z'));
      a.mcpClients.seen('busy', 'audience');
      a.mcpClients.seen('busy', 'audience');
      expect(queued()).toBe(1);
      vi.setSystemTime(new Date('2030-01-01T10:11:00.000Z'));
      a.mcpClients.seen('busy', 'audience');
      expect(queued()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
    await exchange();
    expect(b.mcpClients.get('busy')!.lastSeen).toBe('2030-01-01T10:11:00.000Z');
  });

  it('queues the clients a machine had once, when it was syncing before this build', () => {
    a.db.db.prepare(`DELETE FROM kv WHERE key = 'sync.mcp_clients_seeded'`).run();
    a.db.db.prepare(`DELETE FROM sync_outbox WHERE entity = 'mcp_client'`).run();
    a.db.outbox.arm('mac-a', 'test-mac');
    const ids = (a.db.db.prepare(`SELECT entity_id FROM sync_outbox WHERE entity = 'mcp_client'`).all() as { entity_id: string }[]).map((r) => r.entity_id);
    expect(ids.sort()).toEqual(a.mcpClients.list().map((c) => c.id).sort());
    a.db.outbox.arm('mac-a', 'test-mac');
    expect((a.db.db.prepare(`SELECT COUNT(*) AS n FROM sync_outbox WHERE entity = 'mcp_client'`).get() as { n: number }).n).toBe(ids.length);
  });
});

describe('a machine updating from the build before sync', () => {
  it('keeps a removal it made on the old build over an approval another machine made earlier', async () => {
    // Its database as the old build left it: no decided_at, a client Ben removed and one he approved there.
    vi.resetModules();
    const dir = mkdtempSync(join(tmpdir(), 'omni-sync-legacy-'));
    process.env.OMNI_DATA_DIR = dir;
    const { DatabaseSync } = await import('node:sqlite');
    const old = new DatabaseSync(join(dir, 'omni.db'));
    old.exec(`CREATE TABLE mcp_clients (id TEXT PRIMARY KEY, status TEXT NOT NULL, via TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL);
      INSERT INTO mcp_clients VALUES ('cut-off', 'removed', NULL, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
      INSERT INTO mcp_clients VALUES ('kept', 'approved', 'client', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');`);
    old.close();
    const updatedAt = new Date().toISOString();
    await import('../db.ts');
    const { mcpClients } = await import('../mcp-clients.ts');
    const earlier = new Date(Date.parse(updatedAt) - 60_000).toISOString();
    const approval = { decision: 'approved' as const, decidedAt: earlier, firstSeen: earlier, lastSeen: earlier };
    // An approval made on an updated machine before this one updated, arriving now.
    expect(mcpClients.syncData('cut-off')!.decidedAt! >= updatedAt).toBe(true);
    mcpClients.applyRemote('cut-off', approval);
    expect(mcpClients.status('cut-off')).toBe('removed');
    // An approval from the old build stays undated, so a dated removal from another machine still wins over it.
    expect(mcpClients.syncData('kept')!.decidedAt).toBeNull();
    mcpClients.applyRemote('kept', { ...approval, decision: 'removed' });
    expect(mcpClients.status('kept')).toBe('removed');
    // A new Approve here brings the cut-off client back, and goes out dated.
    mcpClients.approve('cut-off');
    expect(mcpClients.status('cut-off')).toBe('approved');
  });
});

describe('who may approve a client through sync', () => {
  const at = () => new Date().toISOString();
  const approval = (machine: string, id: string, decidedAt = at()): Change => ({
    machine_id: machine,
    entity: 'mcp_client',
    entity_id: id,
    op: 'upsert',
    data: { decision: 'approved', decidedAt, firstSeen: decidedAt, lastSeen: decidedAt },
    ts: at(),
  });

  it('refuses an unsigned approval, so a relay writer cannot let a client in', async () => {
    await relay.push([approval('mac-a', 'forged-unsigned')]);
    expect((await b.worker.syncNow()).error).toBeUndefined();
    expect(b.mcpClients.status('forged-unsigned')).toBeNull();
    expect(b.verify.refusedChanges().some((r) => r.entityId === 'forged-unsigned' && r.reason === 'unsigned')).toBe(true);
  });

  it('holds an approval from a machine that is not trusted yet', async () => {
    const paired = relay.pairedMachines.bind(relay);
    relay.pairedMachines = async () => new Set([...(await paired())].filter((m) => m !== 'mac-x'));
    try {
      await relay.push([signAs(approval('mac-x', 'from-stranger'))]);
      expect((await b.worker.syncNow()).error).toBeUndefined();
      expect(b.mcpClients.status('from-stranger')).toBeNull();
      expect(b.verify.heldActions()).toContainEqual(expect.objectContaining({ machine: 'mac-x', reason: 'untrusted' }));
    } finally {
      relay.pairedMachines = paired;
    }
  });

  it('takes a signed approval from a paired machine, dated no later than the change that carries it', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const signed = signAs(approval('mac-c', 'from-paired', future));
    await relay.push([signed]);
    expect((await b.worker.syncNow()).error).toBeUndefined();
    expect(b.mcpClients.status('from-paired')).toBe('approved');
    // The future date is cut to the change's own time, so Ben's later removal on B wins, even over the same change
    // delivered again.
    await tick();
    b.mcpClients.remove('from-paired');
    await relay.push([signed]);
    expect((await b.worker.syncNow()).error).toBeUndefined();
    expect(b.mcpClients.status('from-paired')).toBe('removed');
  });
});
