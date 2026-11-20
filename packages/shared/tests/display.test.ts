import { describe, expect, it } from 'vitest';
import { MARK, STATUS, type Glyph, type Mark } from '../status.ts';
import { glyphLabel, markLabel, parseDisplay, sameDisplay, parseDisplayPatch, PLAIN_GLYPH, PLAIN_MARK, plainDetail, showsCode, statusWord, term, TERMS } from '../display.ts';

const FIVE = ['Working', 'Needs you', 'Done', 'Failed', 'Stopped'];

describe('the five status words', () => {
  it('maps every one of the 19 marks onto five words', () => {
    const marks = Object.keys(MARK) as Mark[];
    expect(marks).toHaveLength(19);
    expect(new Set(marks.map((m) => PLAIN_MARK[m]))).toEqual(new Set(FIVE));
    expect(new Set((Object.keys(STATUS) as Glyph[]).map((g) => PLAIN_GLYPH[g]))).toEqual(new Set(FIVE));
  });

  it('puts the state that waits on the user under Needs you', () => {
    for (const m of ['question', 'crew_question', 'limited', 'held', 'review', 'signin'] as Mark[]) expect(PLAIN_MARK[m]).toBe('Needs you');
    expect(PLAIN_GLYPH.limited).toBe('Needs you');
  });

  it('keeps the technical label with the switch on and gives it as the sub line off', () => {
    expect(markLabel('limited', true)).toBe(MARK.limited.label);
    expect(markLabel('limited', false)).toBe('Needs you');
    expect(plainDetail('limited')).toBe(MARK.limited.label);
    // A label that says no more than its word has no sub line.
    expect(plainDetail('working')).toBeNull();
    expect(plainDetail('done')).toBeNull();
    expect(glyphLabel('queued', true)).toBe('Queued');
    expect(glyphLabel('queued', false)).toBe('Working');
  });

  it('names a thread status', () => {
    expect(statusWord('running', true)).toBe('Running');
    expect(statusWord('running', false)).toBe('Working');
    expect(statusWord('stopped', false)).toBe('Stopped');
    expect(statusWord('imported', false)).toBe('Stopped');
  });
});

describe('run control names', () => {
  it('reads plain off and technical on', () => {
    expect(term('steer', true)).toBe('Steer');
    expect(term('steerNow', false)).toBe('Add to this');
    expect(term('interrupt', false)).toBe('Stop and send');
    expect(term('newDelegation', false)).toBe('New');
    for (const t of Object.values(TERMS)) expect(t.plain).not.toBe('');
  });
});

describe('the switches', () => {
  it('shows code detail with the switch on or in a channel with a repo', () => {
    expect(showsCode({ technical: false }, { repo_path: '' })).toBe(false);
    expect(showsCode({ technical: false }, null)).toBe(false);
    expect(showsCode({ technical: false }, { repo_path: '/code/shop' })).toBe(true);
    expect(showsCode({ technical: true }, null)).toBe(true);
  });

  it('parses a stored value and a patch', () => {
    expect(parseDisplay(null)).toEqual({ technical: false, shopify: false, openItems: false });
    expect(parseDisplay({ technical: true })).toEqual({ technical: true, shopify: false, openItems: false });
    expect(parseDisplay({ openItems: true })).toEqual({ technical: false, shopify: false, openItems: true });
    expect(parseDisplay({ openItems: 'yes' }).openItems).toBe(false);
    expect(parseDisplayPatch({ shopify: true })).toEqual({ shopify: true });
    expect(parseDisplayPatch({ openItems: false })).toEqual({ openItems: false });
    expect(parseDisplayPatch({ openItems: 'no' })).toBeNull();
    expect(parseDisplayPatch({ technical: 'yes' })).toBeNull();
    expect(parseDisplayPatch({})).toBeNull();
  });

  it('compares every switch, the Open items card included', () => {
    const a = parseDisplay({ technical: true });
    expect(sameDisplay(a, { ...a })).toBe(true);
    expect(sameDisplay(a, { ...a, openItems: true })).toBe(false);
  });
});
