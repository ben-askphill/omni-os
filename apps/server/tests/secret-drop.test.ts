import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryTransport } from '../sync/transport.ts';
import { tailscaleStatus, waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// set_secret with a machine: A seals the value to B's published key and B saves it in its own store after it syncs.
// Two real servers in one process with one in-memory relay, each with the file secret store in its own data dir.

const relay = new MemoryTransport();
const NODE_A = { id: 'nA', dns: 'mac-a.tail1234.ts.net' };
const NODE_B = { id: 'nB', dns: 'box-b.tail1234.ts.net' };
const VALUE = 'sk-live-very-secret-value-123';
let a: Mac;
let b: Mac;

const both = async () => {
  await a.sync();
  await b.sync();
  await a.sync();
  await b.sync();
  await a.sync();
};
const storeOf = (m: Mac): Record<string, string> => {
  try {
    return JSON.parse(readFileSync(join(m.tmp, 'data', 'secrets.json'), 'utf8'));
  } catch {
    return {};
  }
};
const send = (body: Record<string, unknown>) => a.json('/secrets/send', { body });

beforeAll(async () => {
  a = await bootMac('mac-a', 'Mac A', relay, { OMNI_SECRET_STORE: 'file' });
  a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  b = await bootMac('box-b', 'Box B', relay, { OMNI_SECRET_STORE: 'file' });
  b.tailnet(tailscaleStatus(NODE_B, [{ ...NODE_A, online: true }]));
  for (const m of [a, b]) {
    await m.sync();
    await waitFor(() => (m.db.kv.get(`devices.${m.id}`) as { sealKey?: string } | undefined)?.sealKey, `${m.id} to publish its key`);
    await m.sync();
  }
  await a.sync();
}, 30_000);

describe('setting a secret on another machine', () => {
  it('each machine publishes a public key and keeps the private one out of threads', () => {
    const rec = a.db.kv.get('devices.box-b') as { sealKey?: string };
    expect(rec.sealKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Object.keys(storeOf(b))).toContain('global/OMNI_SEAL_KEY');
  });

  it('seals it to the machine by name, which saves it after it syncs and answers', async () => {
    const res = await send({ machine: 'box b', name: 'STRIPE_KEY', value: VALUE, scope: 'global' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ machine: { id: 'box-b', name: 'Box B' }, name: 'STRIPE_KEY', scope: 'global', state: 'sent' });
    expect(storeOf(a)['global/STRIPE_KEY']).toBeUndefined();
    await both();
    expect(storeOf(b)['global/STRIPE_KEY']).toBe(VALUE);
    expect((await b.json('/secrets')).body).toContainEqual(expect.objectContaining({ scope: 'global', name: 'STRIPE_KEY' }));
    expect((await a.json(`/secrets/sent/${res.body.id}`)).body).toMatchObject({ state: 'accepted', reason: null });
    expect((await a.json('/secrets/sent')).body[0]).toMatchObject({ id: res.body.id, state: 'accepted' });
    // The relay only ever saw ciphertext, and the sender drops even that once answered.
    expect(JSON.stringify(relay.changes)).not.toContain(VALUE);
    expect((a.db.kv.get(`secretdrop.${res.body.id}`) as { sealed: unknown }).sealed).toBeNull();
  });

  it('a second sync changes nothing, and a channel scope lands in that scope', async () => {
    const res = await send({ machine: 'box-b', name: 'SHOP_TOKEN', value: 'one', scope: 'channel:shop' });
    await both();
    await both();
    expect(storeOf(b)['channel:shop/SHOP_TOKEN']).toBe('one');
    expect((await a.json(`/secrets/sent/${res.body.id}`)).body.state).toBe('accepted');
  });

  it('saves it here without a machine', async () => {
    const res = await send({ name: 'LOCAL_ONLY', value: 'here' });
    expect(res.body).toMatchObject({ machine: null, state: 'accepted' });
    expect(storeOf(a)['global/LOCAL_ONLY']).toBe('here');
  });

  it("refuses Omni's own credentials, an unknown machine, this machine and a bad name", async () => {
    expect((await send({ machine: 'box-b', name: 'OMNI_RELAY_TOKEN', value: 'x' })).status).toBe(403);
    expect((await send({ name: 'OMNI_SEAL_KEY', value: 'x' })).status).toBe(403);
    const unknown = await send({ machine: 'Nope', name: 'X_KEY', value: 'x' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toContain('Box B (box-b)');
    expect((await send({ machine: 'mac-a', name: 'X_KEY', value: 'x' })).status).toBe(400);
    expect((await send({ machine: 'box-b', name: 'lower', value: 'x' })).status).toBe(400);
    expect((await send({ machine: 'box-b', name: 'TWO_LINES', value: 'a\nb' })).status).toBe(400);
  });

  it('refuses names that change how programs start, sent to another machine or saved here, and takes look-alikes', async () => {
    for (const name of ['PATH', 'NODE_OPTIONS', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'GIT_SSH_COMMAND']) {
      const away = await send({ machine: 'box-b', name, value: 'placeholder' });
      expect(away.status, name).toBe(403);
      expect(away.body.error, name).toBe(`${name} changes how every thread's programs start, so only Settings can set it.`);
      expect((await send({ name, value: 'placeholder' })).status, name).toBe(403);
      expect(storeOf(a)[`global/${name}`], name).toBeUndefined();
    }
    for (const name of ['PATHS', 'LDAP_URL', 'DYLDX']) expect((await send({ name, value: 'placeholder' })).status, name).toBe(200);
    expect(JSON.stringify(relay.changes)).not.toContain('NODE_OPTIONS');
  });

  it('the target refuses one sealed to another key, and one past its 24 hours', async () => {
    const res = await send({ machine: 'box-b', name: 'WRONG_KEY', value: 'x' });
    const drop = a.db.kv.get(`secretdrop.${res.body.id}`) as Record<string, any>;
    // Sealed for another drop: the bound id no longer matches, so it does not open.
    a.db.kv.set(`secretdrop.${res.body.id}`, { ...drop, name: 'RENAMED_KEY' });
    const late = await send({ machine: 'box-b', name: 'LATE_KEY', value: 'x' });
    const lateDrop = a.db.kv.get(`secretdrop.${late.body.id}`) as Record<string, any>;
    a.db.kv.set(`secretdrop.${late.body.id}`, { ...lateDrop, expires_at: new Date(Date.now() - 1000).toISOString() });
    await both();
    expect(storeOf(b)['global/RENAMED_KEY']).toBeUndefined();
    expect(storeOf(b)['global/LATE_KEY']).toBeUndefined();
    expect((await a.json(`/secrets/sent/${res.body.id}`)).body).toMatchObject({ state: 'rejected', reason: expect.stringContaining('another key') });
    expect((await a.json(`/secrets/sent/${late.body.id}`)).body).toMatchObject({ state: 'rejected', reason: expect.stringContaining('24 hours') });
  });
});
