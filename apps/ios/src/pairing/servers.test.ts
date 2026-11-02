import { describe, expect, it } from 'vitest';

import {
  activeServer,
  defaultServerName,
  emptyIndex,
  parseServerIndex,
  parseStoredServerIndex,
  removeServer,
  serializeServerIndex,
  setActive,
  upsertServer,
  type PairedServer,
} from './servers';

function server(id: string, origin = `https://${id}.example.com`): PairedServer {
  return { id, name: id, origin, sessionId: `session-${id}`, pairedAt: '2026-11-02T10:00:00.000Z' };
}

describe('upsertServer', () => {
  it('adds a server and makes it active', () => {
    const index = upsertServer(upsertServer(emptyIndex, server('a')), server('b'));
    expect(index.servers.map((s) => s.id)).toEqual(['a', 'b']);
    expect(activeServer(index)?.id).toBe('b');
  });

  it('replaces a server with the same origin instead of adding a second record', () => {
    const first = upsertServer(upsertServer(emptyIndex, server('a')), server('b'));
    const index = upsertServer(first, { ...server('a'), sessionId: 'fresh' });
    expect(index.servers).toHaveLength(2);
    expect(index.servers.find((s) => s.id === 'a')?.sessionId).toBe('fresh');
    expect(activeServer(index)?.id).toBe('a');
  });
});

describe('setActive', () => {
  it('switches the active server and ignores an unknown id', () => {
    const index = upsertServer(upsertServer(emptyIndex, server('a')), server('b'));
    expect(activeServer(setActive(index, 'a'))?.id).toBe('a');
    expect(setActive(index, 'nope')).toEqual(index);
  });
});

describe('removeServer', () => {
  const two = upsertServer(upsertServer(emptyIndex, server('a')), server('b'));

  it('activates the next server when the active one is removed', () => {
    const index = removeServer(two, 'b');
    expect(index.servers.map((s) => s.id)).toEqual(['a']);
    expect(activeServer(index)?.id).toBe('a');
  });

  it('keeps the active server when another one is removed', () => {
    expect(activeServer(removeServer(two, 'a'))?.id).toBe('b');
  });

  it('leaves no active server when the last one is removed', () => {
    expect(removeServer(removeServer(two, 'a'), 'b')).toEqual(emptyIndex);
  });
});

describe('stored index', () => {
  it('round-trips through its serialized form', () => {
    const index = upsertServer(upsertServer(emptyIndex, server('a')), server('b'));
    expect(parseStoredServerIndex(serializeServerIndex(index))).toEqual(index);
  });

  it.each([
    ['malformed JSON', '{not json'],
    ['a missing store', null],
    ['a wrong shape', '{"servers":"nope"}'],
    ['a server missing a field', '{"activeId":"a","servers":[{"id":"a"}]}'],
    ['duplicate ids', JSON.stringify({ activeId: 'a', servers: [server('a'), server('a', 'https://x.example.com')] })],
  ])('reads %s as empty', (_label, text) => {
    expect(parseStoredServerIndex(text)).toEqual(emptyIndex);
  });

  it('falls back to the first server when the active id is stale', () => {
    const parsed = parseServerIndex({ activeId: 'gone', servers: [server('a')] });
    expect(parsed.activeId).toBe('a');
  });
});

describe('defaultServerName', () => {
  it('uses the hostname without the port', () => {
    expect(defaultServerName('https://omni.example.com:8443')).toBe('omni.example.com');
  });
});
