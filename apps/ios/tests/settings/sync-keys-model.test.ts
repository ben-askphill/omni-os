import { OmniHttpError, type RefusedChange, type SyncDeviceKey } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import { loadOptional, optionalView } from '../../src/settings/optional-remote';
import { confirmKeyConfirmation, fingerprintLabel, refusedRows, syncKeyRows, withKeyConfirmed } from '../../src/settings/sync-keys-model';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function device(over: Partial<SyncDeviceKey> = {}): SyncDeviceKey {
  return { id: 'air', name: 'Air', current: false, fingerprint: 'ab12cd34ef56', pinnedFingerprint: 'ab12cd34ef56', keyChanged: false, ...over };
}

function refused(over: Partial<RefusedChange> = {}): RefusedChange {
  return { id: 1, at: ago(5 * 60_000), machine: 'Air', entity: 'remote_command', entityId: 'rc1', reason: 'Bad signature', ...over };
}

describe('fingerprintLabel', () => {
  it('groups a hex fingerprint in fours, colons or not', () => {
    expect(fingerprintLabel('AB12CD34EF56')).toBe('ab12 cd34 ef56');
    expect(fingerprintLabel('ab:12:cd:34:e')).toBe('ab12 cd34 e');
  });

  it('shows anything else as it came, and says when there is no key', () => {
    expect(fingerprintLabel('SHA256:x9/Kq+=')).toBe('SHA256:x9/Kq+=');
    expect(fingerprintLabel(null)).toBe('No key yet');
    expect(fingerprintLabel(' ')).toBe('No key yet');
  });
});

describe('syncKeyRows', () => {
  it('puts this machine first and shows each fingerprint', () => {
    const rows = syncKeyRows([device(), device({ id: 'studio', name: 'Studio', current: true, fingerprint: '00ff00ff' })]);
    expect(rows.map((r) => [r.id, r.fingerprint])).toEqual([
      ['studio', '00ff 00ff'],
      ['air', 'ab12 cd34 ef56'],
    ]);
  });

  it('shows Key changed, the pinned key and Confirm new key only on a machine whose key changed', () => {
    const [changed, steady] = syncKeyRows([device({ keyChanged: true, fingerprint: '1111', pinnedFingerprint: '2222' }), device({ id: 'b', name: 'B' })]);
    expect(changed).toMatchObject({ keyChanged: true, fingerprint: '1111', pinned: '2222', confirmLabel: 'Confirm new key for Air' });
    expect(steady).toMatchObject({ keyChanged: false, pinned: null, confirmLabel: null });
  });

  it('never offers Confirm new key for this machine', () => {
    const [here] = syncKeyRows([device({ current: true, keyChanged: true })]);
    expect(here).toMatchObject({ keyChanged: false, confirmLabel: null });
  });

  it('pins the new key after a confirm', () => {
    const [d] = withKeyConfirmed([device({ keyChanged: true, fingerprint: '1111', pinnedFingerprint: '2222' })], 'air');
    expect(d).toMatchObject({ keyChanged: false, pinnedFingerprint: '1111' });
  });

  it('names the fingerprint to compare in the confirm', () => {
    const c = confirmKeyConfirmation({ name: 'Air', fingerprint: '1111 2222' });
    expect(c.title).toBe('Confirm new key for Air?');
    expect(c.message).toContain('1111 2222');
    expect(c.confirmLabel).toBe('Confirm new key');
  });
});

describe('refusedRows', () => {
  it('lists newest first with machine, entity and reason', () => {
    const rows = refusedRows([refused({ id: 1, at: ago(3 * 3_600_000), reason: 'Unsigned' }), refused({ id: 2 })], NOW);
    expect(rows).toEqual([
      { key: '2', title: 'Bad signature', detail: 'Air · remote_command rc1 · 5m ago' },
      { key: '1', title: 'Unsigned', detail: 'Air · remote_command rc1 · 3h ago' },
    ]);
  });

  it('shortens a long entity id and fills a missing machine', () => {
    const [row] = refusedRows([refused({ machine: '', entityId: '0123456789abcdef' })], NOW);
    expect(row.detail).toBe('Unknown machine · remote_command 0123456789ab… · 5m ago');
  });
});

describe('an optional piece on an older server', () => {
  const notFound = new OmniHttpError({ kind: 'http', status: 404, message: 'Not found', body: null, retryAfter: null });

  it('turns a 404 into missing and passes other failures on', async () => {
    expect(await loadOptional(Promise.reject(notFound))).toEqual({ missing: true });
    expect(await loadOptional(Promise.resolve([1]))).toEqual({ missing: false, value: [1] });
    const boom = new OmniHttpError({ kind: 'http', status: 500, message: 'Boom', body: null, retryAfter: null });
    await expect(loadOptional(Promise.reject(boom))).rejects.toBe(boom);
  });

  it('hides when missing, and otherwise loads, fails or shows', () => {
    expect(optionalView({ data: { missing: true }, error: null, loading: false })).toBe('hidden');
    expect(optionalView({ data: null, error: null, loading: true })).toBe('loading');
    expect(optionalView({ data: null, error: 'Offline', loading: false })).toBe('error');
    expect(optionalView({ data: { missing: false, value: [] }, error: 'Offline', loading: false })).toBe('ready');
  });
});
