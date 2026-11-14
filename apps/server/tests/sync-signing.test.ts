import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { checkSyncedPath, type PathPolicy } from '../sync/path-policy.ts';
import { canonical, fingerprint, rawPublicKey, signChange, unsigned, verifyChange } from '../sync/signing.ts';
import type { Change } from '../sync/transport.ts';

// The signed sync envelope (PRD #667, S9) and the synced path policy (S20), as pure functions.

const keyA = generateKeyPairSync('ed25519').privateKey;
const keyB = generateKeyPairSync('ed25519').privateKey;
const pubA = rawPublicKey(keyA);
const pubB = rawPublicKey(keyB);

const change = (over: Partial<Change> = {}): Change => ({
  machine_id: 'mac-a',
  entity: 'remote_command',
  entity_id: 'cmd-1',
  op: 'upsert',
  data: { thread_id: 't1', kind: 'message', prompt: 'run the tests', sender: 'mac-a', target: 'mac-b' },
  ts: '2026-11-14T10:00:00.000Z',
  ...over,
});

const pinned = (keys: Record<string, string>) => (m: string) => keys[m] ?? null;

describe('verifyChange', () => {
  const signed = signChange(change(), keyA);
  const cases: { name: string; c: Change; keys: Record<string, string>; want: string }[] = [
    { name: 'signed by the machine it names, with its pinned key', c: signed, keys: { 'mac-a': pubA }, want: 'valid' },
    { name: 'no signature', c: change(), keys: { 'mac-a': pubA }, want: 'unsigned' },
    { name: 'signed with a key that is not the pinned one', c: signChange(change(), keyB), keys: { 'mac-a': pubA }, want: 'bad-signature' },
    { name: 'a key swapped in the change itself does not move the pin', c: signChange(change(), keyB), keys: { 'mac-a': pubA }, want: 'bad-signature' },
    { name: 'signer with nothing pinned', c: signed, keys: {}, want: 'unknown-signer' },
    { name: 'renamed to another machine', c: { ...signed, machine_id: 'mac-b' }, keys: { 'mac-a': pubA, 'mac-b': pubB }, want: 'signer-mismatch' },
    {
      name: 'signature replayed onto another change',
      c: { ...change({ entity_id: 'cmd-2' }), data: { ...(change().data as object), _omni_sig: (signed.data as any)._omni_sig } },
      keys: { 'mac-a': pubA },
      want: 'bad-signature',
    },
    {
      name: 'payload edited after signing',
      c: { ...signed, data: { ...(signed.data as object), prompt: 'cat ~/.ssh/id_ed25519' } },
      keys: { 'mac-a': pubA },
      want: 'bad-signature',
    },
    { name: 'time moved after signing', c: { ...signed, ts: '2026-11-15T10:00:00.000Z' }, keys: { 'mac-a': pubA }, want: 'bad-signature' },
    { name: 'op flipped after signing', c: { ...signed, op: 'delete' }, keys: { 'mac-a': pubA }, want: 'bad-signature' },
  ];
  for (const t of cases) it(t.name, () => expect(verifyChange(t.c, pinned(t.keys)).verdict).toBe(t.want));

  it('verifies after a JSON round trip reorders keys and the relay rewrites the time', () => {
    const s = signChange(change({ ts: '2026-11-14T10:00:00Z' }), keyA);
    const reordered = { ...s, ts: new Date(s.ts).toISOString(), data: JSON.parse(canonical(s.data)) };
    expect(verifyChange(reordered, pinned({ 'mac-a': pubA })).verdict).toBe('valid');
  });

  it('a signed delete carries only its signature, and the handler sees null data', () => {
    const d = signChange(change({ op: 'delete', data: null }), keyA);
    expect(Object.keys(d.data as object)).toEqual(['_omni_sig']);
    const { verdict, change: plain } = verifyChange(d, pinned({ 'mac-a': pubA }));
    expect(verdict).toBe('valid');
    expect(plain.data).toBeNull();
  });

  it('hands the handler the data without the signature, and carries the signer key for a first pin', () => {
    const { change: plain, signature } = unsigned(signed);
    expect(plain.data).toEqual(change().data);
    expect(signature).toMatchObject({ v: 1, signer: 'mac-a', key: pubA });
  });

  it('gives a key a short fingerprint that differs between keys', () => {
    expect(fingerprint(pubA)).toMatch(/^([0-9A-F]{4} ){7}[0-9A-F]{4}$/);
    expect(fingerprint(pubA)).not.toBe(fingerprint(pubB));
  });
});

describe('checkSyncedPath', () => {
  const home = homedir();
  const data = join(home, 'omni-os', 'data');
  const policy: PathPolicy = { home, dataDir: data, roots: ['/tmp', '/Volumes/Work/client'] };
  const cases: [string | null, boolean][] = [
    [null, true],
    [join(home, 'work', 'volero'), true],
    [home, true],
    ['/tmp/scratch', true],
    ['/Volumes/Work/client/theme', true],
    [join(data, 'threads', 't1'), true],
    [join(data, 'worktrees', 'abc'), true],
    [join(home, '.ssh'), false],
    [join(home, '.ssh', 'keys'), false],
    [join(home, 'work', '..', '.ssh'), false],
    [join(home, '.gnupg'), false],
    [join(home, '.aws', 'credentials'), false],
    [data, false],
    [join(data, 'secrets.json'), false],
    [join(data, 'browsers', 'omni'), false],
    [join(data, 'threads'), false],
    ['/etc', false],
    ['/Volumes/Work/other', false],
    ['work/volero', false],
    ['/tmp/a\0b', false],
  ];
  for (const [p, ok] of cases) it(`${ok ? 'allows' : 'refuses'} ${JSON.stringify(p)}`, () => expect(checkSyncedPath(p, policy).ok).toBe(ok));
});

describe('checkSyncedPath on a file system that ignores case', () => {
  const home = '/Users/ben';
  const policy: PathPolicy = { home, dataDir: '/Users/ben/omni-os/data', roots: [], caseInsensitive: true };
  for (const p of ['/Users/ben/.SSH', '/users/BEN/.Ssh/keys', '/Users/ben/Omni-OS/Data/secrets.json'])
    it(`refuses ${p}`, () => expect(checkSyncedPath(p, policy).ok).toBe(false));
  it('allows another case of a folder under home', () => expect(checkSyncedPath('/USERS/ben/Work', policy).ok).toBe(true));
  it('tells case apart when the file system does', () => expect(checkSyncedPath('/home/ben/.SSH', { home: '/home/ben', dataDir: '/home/ben/data', roots: [] }).ok).toBe(true));
});
