// Group threads, slice 3 (ADR 0019): a turn several agents answer folds into a lane per agent, with the collision flag
// above the lanes. Transcript rows in, items out, as every client folds them.
import { describe, expect, it } from 'vitest';
import { buildItems, type TranscriptEvent } from '../transcript-fold.ts';
import { collisionLabel, collisionsIn, editedPath } from '../collisions.ts';
import { laneFold, type LanesItem } from '../lanes.ts';
import { threadView } from '../thread-view.ts';

let id = 0;
const row = (kind: string, payload: unknown, agent: string | null = null): TranscriptEvent => ({
  id: ++id,
  kind,
  payload: JSON.stringify(payload),
  created_at: new Date(Date.UTC(2026, 10, 20, 12, 0, id)).toISOString(),
  agent,
});
const ask = (text: string, to?: string[]) => row('user', { text, source: 'ben', ...(to && { to }) });
const say = (agent: string, text: string) => row('assistant_text', { text }, agent);
const write = (agent: string, path: string) => row('tool_use', { id: `t${id + 1}`, name: 'Write', input: { file_path: path, content: 'x' } }, agent);
const done = (agent: string, ok = true) => row('result', { ok, subtype: ok ? 'success' : 'error', turns: 1 }, agent);
const fold = (events: TranscriptEvent[]) => laneFold(buildItems(events).items, { lead: 'builder', cwd: '/w' });
const lanesOf = (items: ReturnType<typeof fold>) => items.filter((i): i is LanesItem => i.type === 'lanes');

describe('collision rows', () => {
  it('names a file with its folder and keeps the full path for the hover', () => {
    expect(collisionLabel('apps/web/src/components/thread/Composer.tsx')).toBe('thread/Composer.tsx');
    expect(collisionLabel('a.ts')).toBe('a.ts');
  });

  it('reads the files an agent’s edit calls changed, whatever harness made them', () => {
    expect(editedPath({ name: 'Edit', input: { file_path: '/w/a.ts' } })).toBe('/w/a.ts');
    expect(editedPath({ name: 'NotebookEdit', input: { notebook_path: '/w/n.ipynb' } })).toBe('/w/n.ipynb');
    expect(editedPath({ name: 'Delete', input: { file_path: '/w/old.ts' } })).toBe('/w/old.ts');
    expect(editedPath({ name: 'Read', input: { file_path: '/w/a.ts' } })).toBeNull();
    expect(editedPath({ name: 'Bash', input: { command: 'rm a.ts' } })).toBeNull();
  });

  it('keeps a flag open until a commit or Ben clears it', () => {
    const events = [
      row('collision', { key: 'k1', path: 'a.ts', agents: ['builder', 'designer'] }),
      row('collision', { key: 'k2', path: 'src/b.ts', agents: ['builder', 'designer'] }),
    ];
    const [a, b] = events;
    expect(collisionsIn(events).map((c) => [c.path, c.cleared])).toEqual([['a.ts', null], ['src/b.ts', null]]);
    // A clearing names flags by key, the same on every machine.
    const dismissed = [...events, row('collision_cleared', { keys: ['k1'], by: 'dismiss' })];
    expect(collisionsIn(dismissed).map((c) => [c.id, c.cleared])).toEqual([[a.id, 'dismiss'], [b.id, null]]);
    const committed = [...dismissed, row('collision_cleared', { keys: ['k2'], by: 'commit' })];
    expect(collisionsIn(committed).every((c) => c.cleared)).toBe(true);
  });
});

describe('the lane fold', () => {
  it('splits a turn two agents answer into a lane each, with its steps, changed files and the flag above', () => {
    const events = [
      ask('both of you, go', ['builder', 'designer']),
      write('designer', '/w/a.ts'),
      say('builder', 'Looking at the store.'),
      write('builder', '/w/a.ts'),
      row('collision', { key: 'k', path: 'a.ts', agents: ['designer', 'builder'] }),
      say('designer', 'Styled the header.'),
      done('designer'),
      say('builder', 'Wired the API.'),
    ];
    const items = fold(events);
    // Ben's message, then the lanes: nothing else in the flow.
    expect(items.map((i) => i.type)).toEqual(['user', 'lanes']);
    const [block] = lanesOf(items);
    expect(block.lanes.map((l) => [l.agent, l.state, l.files])).toEqual([
      ['builder', 'working', ['a.ts']],
      ['designer', 'done', ['a.ts']],
    ]);
    expect(block.lanes[0].latest).toBe('Wired the API.');
    expect(block.lanes[1].items.map((i) => i.type)).toEqual(['tools', 'text', 'result']);
    expect(block.flags.map((f) => [f.path, f.label, f.cleared])).toEqual([['a.ts', 'a.ts', null]]);
    expect(block.stacked).toBe(false);
  });

  it('keeps the lanes in the history once every agent is done, and stacks them from three agents', () => {
    const events = [
      ask('all three', ['builder', 'designer', 'critic']),
      say('critic', 'Reading.'),
      write('critic', '/w/src/x.ts'),
      say('designer', 'Done here.'),
      done('designer'),
      done('critic', false),
      say('builder', 'All set.'),
      done('builder'),
      ask('thanks'),
      say('builder', 'Welcome.'),
      done('builder'),
    ];
    const items = fold(events);
    expect(items.map((i) => i.type)).toEqual(['user', 'lanes', 'user', 'text', 'result']);
    const [block] = lanesOf(items);
    expect(block.stacked).toBe(true);
    expect(block.lanes.map((l) => [l.agent, l.state])).toEqual([['builder', 'done'], ['designer', 'done'], ['critic', 'failed']]);
    // Collapsed to its latest line: Critic's last step was an edit.
    expect(block.lanes[2].latest).toBe('Writing "x.ts"');
    expect(block.lanes[2].files).toEqual(['src/x.ts']);
  });

  it('leaves a turn one agent answers as it was', () => {
    const events = [ask('just you', ['designer']), say('designer', 'On it.'), done('designer')];
    expect(fold(events).map((i) => i.type)).toEqual(['user', 'text', 'result']);
  });

  it('lets a later message to one agent take that agent’s rows out of the lanes from then on', () => {
    const events = [
      ask('both', ['builder', 'designer']),
      say('designer', 'Starting.'),
      say('builder', 'Starting too.'),
      ask('designer, stop that and look at the footer', ['designer']),
      say('designer', 'Looking at the footer.'),
      done('designer'),
      done('builder'),
    ];
    const items = fold(events);
    expect(items.map((i) => i.type)).toEqual(['user', 'lanes', 'user', 'text', 'result']);
    const [block] = lanesOf(items);
    // Designer's lane ends where the new message took it, and still says how its turn ended.
    expect(block.lanes.map((l) => [l.agent, l.state, l.items.length])).toEqual([['builder', 'done', 2], ['designer', 'done', 1]]);
  });
});

describe('the phone’s turn view', () => {
  it('gives a turn two agents answer a lane each, one per tab, and ends the turn when both have', () => {
    const events = [
      ask('both of you, go', ['builder', 'designer']),
      write('designer', '/w/a.ts'),
      row('collision', { key: 'k', path: 'a.ts', agents: ['designer', 'builder'] }),
      say('designer', 'Styled it.'),
      done('designer'),
      say('builder', 'Still wiring.'),
    ];
    const thread = { status: 'running', harness: 'claude-code', role: 'builder', cwd: '/w' };
    const running = threadView({ events, thread, artifacts: [], children: [] });
    const turn = running.turns.at(-1)!;
    expect(turn.status).toBe('running');
    expect(turn.lanes?.turns.map((l) => [l.author, l.status, l.prose])).toEqual([
      ['builder', 'running', 'Still wiring.'],
      ['designer', 'done', 'Styled it.'],
    ]);
    expect(turn.lanes?.flags.map((f) => f.label)).toEqual(['a.ts']);
    expect(turn.lanes?.files).toEqual({ builder: [], designer: ['a.ts'] });
    expect(turn.lanes?.latest).toEqual({ builder: 'Still wiring.', designer: 'Styled it.' });

    const ended = threadView({ events: [...events, done('builder'), ask('thanks'), say('builder', 'Sure.'), done('builder')], thread: { ...thread, status: 'done' }, artifacts: [], children: [] });
    expect(ended.turns.map((t) => [t.status, !!t.lanes])).toEqual([['done', true], ['done', false]]);
  });
});

describe('a team thread (slice 6)', () => {
  const tell = (to: string, text: string) => row('user', { text, source: 'lead', to: [to] }, 'builder');
  const wake = () => row('user', { text: 'All 2 members have finished.', source: 'team' });

  it("gathers a wave of the lead's messages into one set of lanes, after its last message, until the wake", () => {
    const events = [
      row('user', { text: 'the brief', source: 'conductor' }),
      say('builder', 'Planning.'),
      tell('designer', 'make the visuals'),
      say('designer', 'On it.'),
      tell('critic', 'critique it'),
      say('builder', 'Both have their parts.'),
      done('builder'),
      say('critic', 'Looks fine.'),
      done('critic'),
      done('designer'),
      wake(),
      say('builder', 'Report: done.'),
      done('builder'),
    ];
    const items = fold(events);
    expect(items.map((i) => (i.type === 'user' ? `user:${i.p.source}` : i.type === 'lanes' ? `lanes:${i.lanes.map((l) => l.agent)}` : i.type))).toEqual([
      'user:conductor',
      'text',
      'user:lead',
      'user:lead',
      'lanes:designer,critic',
      'text',
      'result',
      'user:team',
      'text',
      'result',
    ]);
    const [lanes] = lanesOf(items);
    expect(lanes.lanes.map((l) => [l.agent, l.state, l.latest])).toEqual([['designer', 'done', 'On it.'], ['critic', 'done', 'Looks fine.']]);
    // The lead's message says who wrote it.
    const sent = items.find((i) => i.type === 'user' && i.p.source === 'lead');
    expect(sent && 'agent' in sent && sent.agent).toBe('builder');
  });

  it('starts new lanes for a wave after the wake, and stacks from three members', () => {
    const events = [tell('designer', 'one'), done('designer'), wake(), tell('designer', 'two'), tell('critic', 'two'), tell('writer', 'two')];
    const blocks = lanesOf(fold(events));
    expect(blocks.map((b) => [b.lanes.map((l) => l.agent), b.stacked])).toEqual([
      [['designer'], false],
      [['designer', 'critic', 'writer'], true],
    ]);
  });
});

