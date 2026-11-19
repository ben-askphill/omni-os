import { describe, expect, it } from 'vitest';
import { newContext } from '../message-context.ts';
import { parseContexts, readContexts } from '../message-context-kinds.ts';
import { droppedMentions, machineMention, mentionBody, mentions, mentionsMachine } from '../message-context-machine.ts';

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
    expect(mentions("@Ben's MacBook Pro build the page", "Ben's MacBook Pro")).toBe(true);
    expect(mentions('then @OMARCHY, run the tests', 'omarchy')).toBe(true);
    expect(mentions('email me@omarchy.dev', 'omarchy')).toBe(false);
    expect(mentions('@omarchy2 run it', 'omarchy')).toBe(false);
    expect(mentions('omarchy run it', 'omarchy')).toBe(false);
  });

  it('drops the chip of a mention deleted from the text, and knows a machine already mentioned', () => {
    const text = "@Ben's MacBook Pro build the POOWS collection page, @omarchy run the server tests";
    expect(droppedMentions(text, [pro, box])).toEqual([]);
    expect(droppedMentions("@Ben's MacBook Pro build it, then run the tests", [pro, box])).toEqual([box.id]);
    expect(mentionsMachine([pro, box], 'box-1')).toBe(true);
    expect(mentionsMachine([pro], 'box-1')).toBe(false);
  });
});
