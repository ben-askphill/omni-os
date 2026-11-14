import { describe, expect, it } from 'vitest';
import { entityLabel, fingerprintLabel, listedMcpClients, mcpClientName, type McpClient } from '../src/security-settings.ts';

const client = (id: string, status: McpClient['status'], lastSeen: string, name: string | null = null): McpClient => ({ id, name, status, firstSeen: '2026-11-01', lastSeen, via: null });

describe('MCP clients in Settings', () => {
  it('hides removed clients and puts pending ones first, then the most recently seen', () => {
    const list = [client('a', 'approved', '2026-11-02'), client('gone', 'removed', '2026-11-09'), client('b', 'approved', '2026-11-05'), client('p', 'pending', '2026-11-01')];
    expect(listedMcpClients(list).map((c) => c.id)).toEqual(['p', 'b', 'a']);
  });

  it('names a client by its name, else its id', () => {
    expect(mcpClientName(client('cl_1', 'approved', 'x', 'Claude'))).toBe('Claude');
    expect(mcpClientName(client('cl_1', 'approved', 'x', '  '))).toBe('cl_1');
  });
});

describe('sync key fingerprints', () => {
  it('groups hex in fours, first 16 characters', () => {
    expect(fingerprintLabel('AB12CD34EF567890aabbccdd')).toBe('ab12 cd34 ef56 7890');
    expect(fingerprintLabel('ab:12:cd:34')).toBe('ab12 cd34');
  });

  it('says when a machine has no key yet', () => {
    expect(fingerprintLabel(null)).toBe('No signing key yet');
  });
});

describe('refused change labels', () => {
  it('names the action entities plainly', () => {
    expect(entityLabel('remote_command')).toBe('Remote command');
    expect(entityLabel('update.ask.omarchy')).toBe('Update request');
    expect(entityLabel('thread_file')).toBe('thread file');
  });
});
