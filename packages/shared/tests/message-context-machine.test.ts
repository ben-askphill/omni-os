import { describe, expect, it } from 'vitest';
import { newContext } from '../message-context.ts';
import { parseContexts, readContexts } from '../message-context-kinds.ts';
import { chipRecords, machineMention, mentionBody, mentionPieces, mentionSpans, mentionsMachine, sentContext } from '../message-context-machine.ts';
import { agentMention, agentMentionBody } from '../message-context-agent.ts';

const AT = new Date('2026-11-19T12:00:00.000Z');
const ids = (() => {
  let n = 0;
  return { id: () => `c${++n}` };
})();
const pro = newContext(machineMention, mentionBody({ id: 'mac-1', name: "Ben's MacBook Pro", reachability: 'online', lastSeen: '2026-11-19T11:00:00.000Z' }, AT), '', ids);
const box = newContext(machineMention, mentionBody({ id: 'box-1', name: 'omarchy', reachability: 'offline', lastSeen: '2026-11-19T08:00:00.000Z' }, AT), '', ids);

describe('machine_mention', () => {
  it('labels the chip with the @name, and keeps last seen only for an offline machine', () => {
    expect(pro).toMatchObject({ kind: 'machine_mention', v: 1, label: "@Ben's MacBook Pro", body: { machine: 'mac-1', reachability: 'online', last_seen: null, captured_at: AT.toISOString() } });
    expect(box.body).toMatchObject({ last_seen: '2026-11-19T08:00:00.000Z' });
  });

  it('passes the route as it is, and reads back as known', () => {
    const parsed = parseContexts([pro, box]);
    expect(parsed).toEqual({ ok: true, value: [pro, box] });
    expect(readContexts([pro]).map((r) => r.as === 'known' && r.kind)).toEqual(['machine_mention']);
  });

  it('refuses a body without an id, a bad state, a name over two lines or a bad time', () => {
    const bad = (body: unknown) => parseContexts([{ ...pro, body }]);
    expect(bad({ ...pro.body, machine: '' })).toMatchObject({ ok: false, error: expect.stringContaining('machine must be') });
    expect(bad({ ...pro.body, reachability: 'asleep' })).toMatchObject({ ok: false, error: expect.stringContaining('reachability') });
    expect(bad({ ...pro.body, name: 'two\nlines' })).toMatchObject({ ok: false, error: expect.stringContaining('one line') });
    expect(bad({ ...pro.body, last_seen: 'yesterday' })).toMatchObject({ ok: false, error: expect.stringContaining('last_seen') });
    expect(bad({ ...pro.body, captured_at: '2026-11-19' })).toMatchObject({ ok: false, error: expect.stringContaining('captured_at') });
  });

  it('finds @name as a word of its own, in any case', () => {
    const found = (text: string, r = box) => mentionSpans(text, [r]).length > 0;
    expect(found("@Ben's MacBook Pro build the page", pro)).toBe(true);
    expect(found('then @OMARCHY, run the tests')).toBe(true);
    expect(found('email me@omarchy.dev')).toBe(false);
    expect(found('@omarchy2 run it')).toBe(false);
    expect(found('omarchy run it')).toBe(false);
  });

  it('knows a machine already mentioned', () => {
    expect(mentionsMachine([pro, box], 'box-1')).toBe(true);
    expect(mentionsMachine([pro], 'box-1')).toBe(false);
  });
});

describe('machine mentions inline', () => {
  const text = "@Ben's MacBook Pro build it, @omarchy run the tests";
  const pro0 = 0;
  const proEnd = "@Ben's MacBook Pro".length;
  const boxStart = text.indexOf('@omarchy');

  it('finds where each mention sits, in text order, and none for text without its record', () => {
    expect(mentionSpans(text, [box, pro]).map((s) => [s.start, s.end, s.id])).toEqual([
      [pro0, proEnd, pro.id],
      [boxStart, boxStart + '@omarchy'.length, box.id],
    ]);
    expect(mentionSpans(text, [pro]).map((s) => s.id)).toEqual([pro.id]);
    expect(mentionSpans(text, 'not a list')).toEqual([]);
    expect(mentionSpans('mail me@omarchy.dev', [box])).toEqual([]);
  });

  it('lets the longer name win where two overlap', () => {
    const mac = newContext(machineMention, mentionBody({ id: 'm', name: 'Mac', reachability: 'online', lastSeen: null }, AT), '', ids);
    const mini = newContext(machineMention, mentionBody({ id: 'mm', name: 'Mac mini', reachability: 'online', lastSeen: null }, AT), '', ids);
    expect(mentionSpans('@Mac mini and @Mac', [mac, mini]).map((s) => s.id)).toEqual([mini.id, mac.id]);
  });

  it('cuts the text into runs and pills, and keeps the chips of mentions the text does not show', () => {
    expect(mentionPieces(text, [pro, box]).map((p) => [p.text, !!p.span])).toEqual([
      ["@Ben's MacBook Pro", true],
      [' build it, ', false],
      ['@omarchy', true],
      [' run the tests', false],
    ]);
    const other = { id: 'x', kind: 'thread_reference', v: 1, label: 'T-1', note: '', body: {} };
    expect(chipRecords(text, [pro, other])).toEqual([other]);
    expect(chipRecords('build it', [pro, other])).toEqual([pro, other]);
  });
});

describe("a sent message's context", () => {
  const builder = newContext(agentMention, agentMentionBody({ id: 'builder', name: 'Builder' }), '', ids);
  const designer = newContext(agentMention, agentMentionBody({ id: 'designer', name: 'Designer' }), '', ids);
  const other = { id: 'x', kind: 'thread_reference', v: 1, label: 'T-1', note: '', body: {} };

  it('names the agents the text does not, once each, for the line over the bubble, and keeps them out of the chips', () => {
    const again = newContext(agentMention, agentMentionBody({ id: 'designer', name: 'Designer' }), '', ids);
    expect(sentContext('Rework the cart drawer', [builder, other, designer, again])).toEqual({
      chips: [other],
      to: [
        { agent: 'builder', name: 'Builder' },
        { agent: 'designer', name: 'Designer' },
      ],
    });
  });

  it('leaves an agent the text names inline to its pill', () => {
    expect(sentContext('@Builder take the totals', [builder, designer, pro])).toEqual({ chips: [pro], to: [{ agent: 'designer', name: 'Designer' }] });
  });

  it('reads anything but a list as nothing', () => {
    expect(sentContext('hi', 'not a list')).toEqual({ chips: [], to: [] });
  });
});
