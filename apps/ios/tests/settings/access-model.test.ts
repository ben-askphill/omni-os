import { OmniHttpError, type McpClient } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import {
  mcpClientRows,
  removeClientConfirmation,
  ROTATE_CONFIRMATION,
  rotateFailure,
  seenLabel,
  withClient,
  withoutClient,
} from '../../src/settings/access-model';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const httpError = (status: number, message: string) => new OmniHttpError({ kind: 'http', status, message, body: { error: message }, retryAfter: null });

function client(over: Partial<McpClient> = {}): McpClient {
  return { id: 'c1', name: 'claude.ai', status: 'approved', firstSeen: '2026-10-12T09:00:00Z', lastSeen: ago(5 * 60_000), via: 'audience', ...over };
}

describe('Rotate install token', () => {
  it('warns that every device, this iPhone included, pairs again', () => {
    expect(ROTATE_CONFIRMATION.message).toBe('Every signed-in device, this iPhone included, has to pair again.');
  });

  it('tells an app or Google session where to rotate from on a 403', () => {
    expect(rotateFailure(httpError(403, 'Forbidden'))).toEqual({ kind: 'refused', message: 'Rotate from this Mac or a token-paired device.' });
  });

  it("shows the server's own words for any other failure", () => {
    expect(rotateFailure(httpError(500, 'Disk full'))).toEqual({ kind: 'refused', message: 'Disk full' });
  });

  it('treats a 404 as an older server, so the button goes', () => {
    expect(rotateFailure(httpError(404, 'Not found')).kind).toBe('missing');
  });
});

describe('seenLabel', () => {
  it('counts back for recent times and gives a date for old ones', () => {
    expect(seenLabel('Last seen', ago(10_000), NOW)).toBe('Last seen just now');
    expect(seenLabel('Last seen', ago(3 * 3_600_000), NOW)).toBe('Last seen 3h ago');
    expect(seenLabel('First seen', '2026-10-12T09:00:00Z', NOW)).toBe('First seen 12 Oct');
  });

  it('is empty for a time it cannot read', () => {
    expect(seenLabel('First seen', 'never', NOW)).toBe('');
    expect(seenLabel('First seen', null, NOW)).toBe('');
  });
});

describe('mcpClientRows', () => {
  it('hides removed clients and lists pending ones first', () => {
    const rows = mcpClientRows([client({ id: 'a' }), client({ id: 'gone', status: 'removed' }), client({ id: 'p', name: 'ChatGPT', status: 'pending' })], NOW);
    expect(rows.map((r) => r.id)).toEqual(['p', 'a']);
  });

  it('offers Approve only on a pending client, and Remove on every one', () => {
    const [pending, approved] = mcpClientRows([client({ id: 'p', name: 'ChatGPT', status: 'pending' }), client()], NOW);
    expect(pending).toMatchObject({ pending: true, approveLabel: 'Approve ChatGPT', removeLabel: 'Remove ChatGPT' });
    expect(approved).toMatchObject({ pending: false, approveLabel: null, removeLabel: 'Remove claude.ai' });
  });

  it('shows first and last seen, with Pending ahead of them', () => {
    const [pending, approved] = mcpClientRows([client({ status: 'pending', id: 'p' }), client()], NOW);
    expect(pending.detail).toBe('Pending · First seen 12 Oct · Last seen 5m ago');
    expect(approved.detail).toBe('First seen 12 Oct · Last seen 5m ago');
  });

  it('names a client that gave no name by its id', () => {
    expect(mcpClientRows([client({ name: null }), client({ id: 'c2', name: '  ' })], NOW).map((r) => r.name)).toEqual(['c1', 'c2']);
  });

  it('puts bound clients between pending and approved, each most recently seen first', () => {
    const rows = mcpClientRows(
      [
        client({ id: 'a', lastSeen: ago(60_000) }),
        client({ id: 'b-old', status: 'bound', lastSeen: ago(3_600_000) }),
        client({ id: 'p', status: 'pending', lastSeen: ago(7_200_000) }),
        client({ id: 'b-new', status: 'bound', lastSeen: ago(120_000) }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(['p', 'b-new', 'b-old', 'a']);
  });

  it('labels a bound client, explains Approve, and offers both Approve and Remove', () => {
    const [bound] = mcpClientRows([client({ id: 'b', name: 'claude.ai', status: 'bound' })], NOW);
    expect(bound).toMatchObject({
      pending: false,
      detail: 'Bound to this Omni · First seen 12 Oct · Last seen 5m ago',
      hint: 'Approve also lets in tokens without an audience.',
      approveLabel: 'Approve claude.ai',
      removeLabel: 'Remove claude.ai',
    });
  });
});

describe('MCP client edits', () => {
  it('asks before removing, by name', () => {
    expect(removeClientConfirmation({ name: 'ChatGPT' }).title).toBe('Remove ChatGPT?');
  });

  it("puts an approve's answer in place and drops a removed client", () => {
    const list = [client({ id: 'a' }), client({ id: 'p', status: 'pending' })];
    expect(withClient(list, client({ id: 'p', status: 'approved' })).map((c) => c.status)).toEqual(['approved', 'approved']);
    expect(withoutClient(list, 'a').map((c) => c.id)).toEqual(['p']);
  });
});
