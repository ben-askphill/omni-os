import { describe, expect, it } from 'vitest';
import { isAside, liveHeads, replyHeads, type Item } from '../transcript-fold.ts';

const at = '2026-11-23T10:00:00.000Z';
const user = (key: number, extra: Partial<Extract<Item, { type: 'user' }>['p']> = {}, agent?: string): Item => ({ type: 'user', key, at, p: { text: 'hi', ...extra }, ...(agent && { agent }) });
const text = (key: number, agent?: string): Item => ({ type: 'text', key, at, p: { text: 'ok' }, ...(agent && { agent }) });
const result = (key: number): Item => ({ type: 'result', key, p: { ok: true, subtype: 'success', turns: 1 } });
const mod = (key: number): Item => ({ type: 'mod', key, lines: [{ key, at, plugin: 'm', text: 'log' }] });
const risk = (key: number): Item => ({ type: 'merge_risk', key, at, p: {} as Extract<Item, { type: 'merge_risk' }>['p'] });
const collision = (key: number): Item => ({ type: 'collision', key, at, c: {} as Extract<Item, { type: 'collision' }>['c'] });
const member = (key: number): Item => ({ type: 'member', key, at, p: { event: 'joined', agent: 'designer', name: 'Designer' } });

describe('isAside', () => {
  it('names mod lines, merge-risk ratings and collision flags, and nothing a person or agent wrote', () => {
    expect([mod(1), risk(2), collision(3)].map(isAside)).toEqual([true, true, true]);
    expect([user(1), text(2), result(3), member(4), { type: 'lanes' }].map(isAside)).toEqual([false, false, false, false, false]);
  });
});

describe('liveHeads', () => {
  const o = { running: true, lead: 'builder', seats: undefined, mark: 'working' as const };

  it('shows the thread mark on the head of the run the transcript ends on, past asides and results', () => {
    const items = [user(1), text(2), text(3), result(4), mod(5), risk(6), collision(7)];
    const heads = replyHeads(items, 'builder');
    expect([...liveHeads(items, heads, o)]).toEqual([[2, { mark: 'working' }]]);
  });

  it('shows nothing once the thread stops, or while Ben wrote last', () => {
    const items = [user(1), text(2), user(3)];
    const heads = replyHeads(items, 'builder');
    expect(liveHeads(items, heads, { ...o, running: false }).size).toBe(0);
    expect(liveHeads(items, heads, o).size).toBe(0);
  });

  it('reads a lead message to its members as part of the run', () => {
    const items = [user(1), text(2, 'builder'), user(3, { source: 'lead', to: ['designer'] }, 'builder')];
    const heads = replyHeads(items, 'builder');
    expect([...liveHeads(items, heads, o).keys()]).toEqual([2]);
  });

  it('gives each busy seat its own state on its latest head, unless a message to it came after', () => {
    const items = [user(1, { to: ['builder', 'designer'] }), text(2, 'builder'), text(3, 'designer'), user(4, { to: ['designer'] })];
    const heads = replyHeads(items, 'builder');
    const seats = [{ agent: 'builder', state: 'working' as const }, { agent: 'designer', state: 'needs' as const }];
    expect([...liveHeads(items, heads, { ...o, seats })]).toEqual([[2, { member: 'working' }]]);
    expect([...liveHeads(items.slice(0, 3), heads, { ...o, seats })]).toEqual([[3, { member: 'needs' }], [2, { member: 'working' }]]);
    expect(liveHeads(items, heads, { ...o, seats: seats.map((s) => ({ ...s, state: 'idle' as const })) }).size).toBe(0);
  });
});
