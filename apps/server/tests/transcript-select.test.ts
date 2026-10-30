import { describe, expect, it } from 'vitest';
import type { RunName } from '@omni/shared/run-switch.ts';
import type { EventRow } from '../db.ts';
import { buildCarryover, type CarryoverInput } from '../carryover.ts';
import { buildHandover, type HandoverInput } from '../runner/handover.ts';
import { selectEntries, transcriptEntries } from '../transcript-select.ts';

// The transcript selection a run switch's handover and a Carryover share (apps/server/transcript-select.ts), and the
// policies they keep apart: a fork's Carryover sanitises the source's paths and condenses, a handover pins the first
// message and only cuts.

const claude: RunName = { harness: 'claude-code', model: 'opus', effort: 'high', harnessName: 'Claude Code', modelLabel: 'Opus 5.5' };
const codex: RunName = { harness: 'codex', model: 'gpt-5.6-sol', effort: '', harnessName: 'Codex', modelLabel: 'GPT-5.6 Sol' };
const CWD = '/data/worktrees/src';

let id = 0;
const ev = (kind: string, p: unknown): EventRow => ({ id: ++id, thread_id: 'src', kind, payload: JSON.stringify(p), created_at: '' });
const entry = (text: string) => ({ text });

const events = [
  ev('user', { text: `fix ${CWD}/cart.ts`, attachments: [{ name: '/other-mac/uploads/shot.png' }] }),
  ev('tool_use', { id: 'c1', name: 'Bash', input: { command: `cat ${CWD}/cart.ts` } }),
  ev('tool_result', { tool_use_id: 'c1', text: 'export const total = 1;', is_error: false }),
  ev('tool_use', { id: 'sub', name: 'Read', parent: 'c1', input: { file_path: '/x' } }),
  ev('user', { text: 'never sent', dropped: true }),
  ev('assistant_text', { text: 'done' }),
];

const handover = (over: Partial<HandoverInput> = {}): HandoverInput => ({
  from: claude,
  to: codex,
  session: 'fresh',
  user: 'Ben',
  thread: { title: 'Fix the cart', cwd: CWD, branch: 'omni/cart' },
  artifacts: [],
  uploadsDir: '/this-mac/uploads',
  events,
  ...over,
});

const carryover = (over: Partial<CarryoverInput> = {}): CarryoverInput => ({
  source: { id: 'src', title: 'Fix the cart', channel: 'acme', run: claude },
  to: codex,
  user: 'Ben',
  role: null,
  events,
  uid: (n) => `uid-${n}`,
  workspace: { kind: 'snapshot', paths: [CWD] },
  files: null,
  skipped: [],
  uncommitted: [],
  parked: [],
  attachments: [],
  ...over,
});

describe('transcript entries', () => {
  it('reads the same entries for both readers, apart from what each policy renders', () => {
    const plain = transcriptEntries(events, { user: 'Ben', speaker: 'Claude Code', under: () => [], carried: () => '' });
    expect(plain.map((e) => [e.who, e.text, e.task])).toEqual([
      ['user', `[Ben] fix ${CWD}/cart.ts`, true],
      ['tool', `  - Bash: cat ${CWD}/cart.ts\n    Result: export const total = 1;`, false],
      ['agent', '[Claude Code] done', false],
    ]);
    // A tool call's entry ends at its result.
    expect(plain[1].id).toBe(3);

    const h = buildHandover(handover()).text;
    expect(h).toContain(`[Ben] fix ${CWD}/cart.ts\n  - Attachment: shot.png, read from /this-mac/uploads/shot.png`);
    const c = buildCarryover(carryover()).carryover;
    // The fork lists only the attachments Ben was offered (none here), never a path, and reads the source's paths from its root.
    expect(c.recent.map((e) => e.text)).toEqual(['[Ben] fix ./cart.ts', '  - Bash: cat ./cart.ts\n    Result: export const total = 1;', '[Claude Code] done']);
    expect(c.text).not.toContain(CWD);
  });
});

describe('selectEntries', () => {
  const five = ['a'.repeat(9), 'b'.repeat(9), 'c'.repeat(9), 'd'.repeat(9), 'e'.repeat(9)].map(entry);

  it('keeps the newest whole entries that fit and says where the rest were left out', () => {
    const s = selectEntries(five, { room: 20 });
    expect(s.kept.map((e) => e.index)).toEqual([3, 4]);
    expect(s).toMatchObject({ omitted: 3, cutAt: 2 });
  });

  it('pins an entry whatever the room, and leaves out the ones between', () => {
    const s = selectEntries(five, { room: 20, pin: 0 });
    expect(s.kept.map((e) => e.index)).toEqual([0, 4]);
    expect(s).toMatchObject({ omitted: 3, cutAt: 3 });
    expect(selectEntries(five, { room: 0, pin: 0 }).kept.map((e) => e.index)).toEqual([0]);
  });

  it('with `condense`, keeps older entries by their first line while those fit', () => {
    const lines = [entry('old\nmore'), entry('mid\nmore'), entry('new\nmore')];
    const s = selectEntries(lines, { room: 15, condense: true });
    expect(s.kept.map((e) => [e.index, e.text, e.condensed])).toEqual([
      [1, 'mid …', true],
      [2, 'new\nmore', false],
    ]);
    expect(s).toMatchObject({ omitted: 1, cutAt: 0 });
  });

  it('leaves nothing out when everything fits', () => {
    expect(selectEntries(five, { room: 1_000 })).toMatchObject({ omitted: 0, cutAt: -1 });
  });
});
