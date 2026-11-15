import { answersMessage, storeOpenItems, type OpenItem } from '@omni/shared/open-items.ts';
import { describe, expect, it } from 'vitest';

import { answerPlaceholder, answersAfter, answersReply, answersWait, openItemsHeading, pickOption, shownOpenItems } from '../../src/thread/open-items';
import { thread } from './fixtures';

const question: OpenItem = { kind: 'question', text: 'Which port should the dev server use?' };
const decision: OpenItem = { kind: 'decision', text: 'Which database?', options: ['SQLite', 'Postgres'] };
const blocker: OpenItem = { kind: 'blocker', text: 'Add the APNs key to the secret store.' };
const all = storeOpenItems([question, decision, blocker]);

describe('shownOpenItems', () => {
  it('lists the items of a finished turn', () => {
    expect(shownOpenItems(thread({ status: 'done', open_items: all }), false)).toEqual([question, decision, blocker]);
  });

  it('shows nothing while a turn runs, while a message waits or without items', () => {
    expect(shownOpenItems(thread({ status: 'running', open_items: all }), false)).toEqual([]);
    expect(shownOpenItems(thread({ status: 'queued', open_items: all }), false)).toEqual([]);
    expect(shownOpenItems(thread({ status: 'done', open_items: all }), true)).toEqual([]);
    expect(shownOpenItems(thread({ status: 'done', open_items: null }), false)).toEqual([]);
  });

  it('reads a malformed column as none', () => {
    expect(shownOpenItems(thread({ status: 'done', open_items: '{oops' }), false)).toEqual([]);
  });
});

describe('answersWait', () => {
  it('hides the card while a message is queued or sending, as the web card hides while one is queued', () => {
    expect(answersWait(true, null)).toBe(true);
    expect(answersWait(false, { phase: 'sending' })).toBe(true);
    expect(answersWait(false, null)).toBe(false);
  });

  it('keeps the card while the outbox holds a failed send', () => {
    expect(answersWait(false, { phase: 'failed' })).toBe(false);
    const t = thread({ status: 'done', open_items: all });
    expect(shownOpenItems(t, answersWait(false, { phase: 'failed' }))).toHaveLength(3);
  });
});

describe('answersReply', () => {
  it('lets Return send from an empty field once another item has an answer', () => {
    const items = [question, decision, blocker];
    // The focused field (the question's) is empty; the decision has a picked option.
    const answers = pickOption({ [question.text]: '' }, decision, 'Postgres');
    expect(answersReply(items, answers)).toBe(`My answers to what you left open:\n\n- Decision: ${decision.text}\n  Answer: Postgres`);
  });

  it('has nothing to send while no item has an answer', () => {
    expect(answersReply([question, decision], {})).toBeNull();
    expect(answersReply([question, decision], { [question.text]: '   ' })).toBeNull();
  });
});

describe('answersAfter', () => {
  const typed = { [question.text]: '4748', [decision.text]: 'SQLite' };

  it('keeps what was typed on the items a dismiss left', () => {
    expect(answersAfter(all, storeOpenItems([question, blocker]), typed)).toEqual({ [question.text]: '4748' });
  });

  it('starts empty when a later turn asks the same question again', () => {
    // A reply clears the column, then the next turn stores a set that is not a subset of what was on the card.
    expect(answersAfter(all, null, typed)).toEqual({});
    expect(answersAfter(null, storeOpenItems([question]), typed)).toEqual({});
    expect(answersAfter(storeOpenItems([decision]), storeOpenItems([question, decision]), typed)).toEqual({});
  });
});

describe('pickOption', () => {
  it('picks an option, and a second tap on it clears the answer', () => {
    const picked = pickOption({}, decision, 'Postgres');
    expect(picked).toEqual({ [decision.text]: 'Postgres' });
    expect(pickOption(picked, decision, 'SQLite')).toEqual({ [decision.text]: 'SQLite' });
    expect(pickOption(picked, decision, 'Postgres')).toEqual({ [decision.text]: '' });
  });

  it('sends every filled answer as one reply, a picked option among them', () => {
    const answers = pickOption({ [blocker.text]: 'done' }, decision, 'SQLite');
    const items = [question, decision, blocker];
    expect(answersMessage(items, items.map((i) => answers[i.text]))).toBe(
      'My answers to what you left open:\n\n' +
        `- Decision: ${decision.text}\n  Answer: SQLite\n` +
        `- Blocker: ${blocker.text}\n  Answer: done`,
    );
  });
});

describe('labels', () => {
  it('counts the items and hints each answer field as the web card does', () => {
    expect(openItemsHeading(1)).toBe('Open item before this thread is done');
    expect(openItemsHeading(3)).toBe('3 open items before this thread is done');
    expect([question, decision, blocker].map(answerPlaceholder)).toEqual(['Your answer', 'Or write your own answer', 'Note, e.g. done']);
  });
});
