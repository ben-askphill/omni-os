import type { CrewRole } from '@omni/client-core';
import crewJson from '@omni/test-fixtures/wire/crew.json';
import { describe, expect, it } from 'vitest';

import { remoteAgentRows } from '../../src/settings/remote-agents';

// The server's recorded GET /api/crew, with one remote agent on a server whose key is not on this machine.
const crew = crewJson as unknown as CrewRole[];

describe('remoteAgentRows', () => {
  it('lists each remote agent with whether it is connected, and its server only with technical details on (Q30)', () => {
    expect(remoteAgentRows(crew, false)).toEqual([
      { id: 'fixture-agent', name: 'Fixture agent', ok: false, status: "Not connected: Key not on this machine: set FIXTURE_AGENT_KEY in Secrets to the server's key", server: null },
    ]);
    expect(remoteAgentRows(crew, true)[0]?.server).toBe('127.0.0.1:9 · Runs API · 12 turns at once');
  });

  it('lists no local agent, and a hidden one only by its own page', () => {
    expect(remoteAgentRows(crew.filter((r) => !r.server), true)).toEqual([]);
    expect(remoteAgentRows(crew.map((r) => ({ ...r, hidden: true })), true)).toEqual([]);
  });
});
