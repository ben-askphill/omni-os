import { describe, expect, it } from 'vitest';

import { mentionRuns } from '../src/components/mention-runs';

const agent = { id: 'c1', kind: 'agent_mention', v: 1, label: '@Designer', note: '', body: { agent: 'designer', name: 'Designer' } };
const machine = {
  id: 'c2',
  kind: 'machine_mention',
  v: 1,
  label: '@omarchy',
  note: '',
  body: { machine: 'm1', name: 'omarchy', reachability: 'online', last_seen: null, captured_at: '2026-11-23T15:20:00.000Z' },
};

describe('mentionRuns', () => {
  it('is null for a message with no mention its records name', () => {
    expect(mentionRuns('Ask @Designer later', [])).toBeNull();
    expect(mentionRuns('Plain text', [agent])).toBeNull();
  });

  it('splits the text into runs and pills named without their @', () => {
    const runs = mentionRuns('@Designer check it on @omarchy now', [agent, machine]);
    expect(runs?.map((r) => (r.kind === 'text' ? r.text : `[${r.span.kind}:${r.name}]`))).toEqual(['[agent:Designer]', ' check it on ', '[machine:omarchy]', ' now']);
  });

  it('marks a pill that opens a paragraph, so iOS keeps the line height there', () => {
    const runs = mentionRuns('@Designer one\n@omarchy two @Designer', [agent, machine]) ?? [];
    expect(runs.filter((r) => r.kind === 'pill').map((r) => r.kind === 'pill' && r.opens)).toEqual([true, true, false]);
  });
});
