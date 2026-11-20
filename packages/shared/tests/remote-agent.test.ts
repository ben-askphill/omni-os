import { describe, expect, it } from 'vitest';
import { isRemoteAgentHarness, localHarnesses, remoteLedCheckout, remoteLeadPlaceholder, serverStatus } from '../remote-agent.ts';
import { buildItems, memberLine, replyTails, type TranscriptEvent } from '../transcript-fold.ts';

// Remote agents (ADR 0020): their servers leave the pickers, a remote-led thread's checkout is told apart from an old
// one's data folder, and each run of a remote agent's replies ends with a lock line.

describe('remote agents and the pickers', () => {
  it('lists local harnesses only: Hermes and custom harnesses are agents, Cursor Cloud stays a harness', () => {
    const list = ['claude-code', 'codex', 'cursor', 'hermes', 'cursor-cloud', 'custom:nomos'].map((id) => ({ id }));
    expect(localHarnesses(list).map((h) => h.id)).toEqual(['claude-code', 'codex', 'cursor', 'cursor-cloud']);
    expect(['hermes', 'custom:nomos', 'cursor-cloud', 'codex', null].map(isRemoteAgentHarness)).toEqual([true, true, false, false, false]);
  });

  it('says how its server is, and who changes files in a thread it leads', () => {
    expect(serverStatus({ available: true })).toBe('Connected');
    expect(serverStatus({ available: false, fix: 'Key not on this machine' })).toBe('Not connected: Key not on this machine');
    expect(remoteLeadPlaceholder('Nomos')).toBe('Message Nomos. A local agent changes files: @ one to seat it');
  });

  it('tells a remote-led thread’s checkout from the data folder an older one ran in', () => {
    const id = '1b2c3d4e-0000-4000-8000-000000000000';
    expect(remoteLedCheckout({ id, harness: 'custom:nomos', cwd: `/Users/ben/omni/data/worktrees/${id}` })).toBe(true);
    expect(remoteLedCheckout({ id, harness: 'hermes', cwd: '/Users/ben/code/shop' })).toBe(true);
    expect(remoteLedCheckout({ id, harness: 'hermes', cwd: `/Users/ben/omni/data/threads/${id}` })).toBe(false);
    expect(remoteLedCheckout({ id, harness: 'claude-code', cwd: `/Users/ben/omni/data/worktrees/${id}` })).toBe(false);
  });
});

describe('lock lines and commit lines in the transcript', () => {
  const at = '2026-11-20T10:00:00.000Z';
  const row = (id: number, kind: string, p: unknown, agent?: string): TranscriptEvent => ({ id, kind, payload: JSON.stringify(p), created_at: at, ...(agent && { agent }) });

  it('ends each run of a remote agent’s replies with one lock line, and none under a local agent', () => {
    const { items } = buildItems([
      row(1, 'user', { text: 'What is left?', source: 'ben' }),
      row(2, 'assistant_text', { text: 'Two things.' }),
      row(3, 'assistant_text', { text: 'And a third.' }),
      row(4, 'result', { subtype: 'success' }),
      row(5, 'user', { text: 'Builder, fix it.', source: 'ben', to: ['builder'] }),
      row(6, 'assistant_text', { text: 'Fixed.' }, 'builder'),
      row(7, 'assistant_text', { text: 'Looks right to me.' }, 'nomos'),
    ]);
    const tails = replyTails(items, 'nomos', (a) => a === 'nomos');
    // Rows 2 and 3 fold into one reply, keyed by its first row.
    expect([...tails]).toEqual([
      [2, 'nomos'],
      [7, 'nomos'],
    ]);
  });

  it('reads Ben’s commit in a remote-led thread as a quiet line', () => {
    const { items } = buildItems([row(1, 'member', { event: 'committed', agent: '', name: 'Ben', commit: { sha: 'abc', message: 'Add the notes', files: 1 } })]);
    expect(items[0]).toMatchObject({ type: 'member', p: { event: 'committed', commit: { files: 1 } } });
    expect(memberLine((items[0] as Extract<(typeof items)[0], { type: 'member' }>).p)).toBe('Ben committed 1 file: Add the notes');
    // With no name set, the line still starts with a capital.
    expect(memberLine({ event: 'committed', name: 'the user', commit: { sha: 'abc', message: '', files: 2 } })).toBe('The user committed 2 files');
  });
});
