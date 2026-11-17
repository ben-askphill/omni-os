import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { answerOf, answersOf, canAdvance, choose, HEADER_MAX, newDraft, OPTIONS_MAX, OPTIONS_MIN, parseAnswers, parseQuestions, QUESTIONS_MAX, questionsIn, resultText, shortHeader, stateOf, type Question } from '../question.ts';

const opt = (label: string) => ({ label, description: `${label} description` });
const q = (over: Partial<Question> = {}) => ({ question: 'Which goal first?', options: [opt('Acne'), opt('Volero')], multiSelect: false, ...over });

describe('parseQuestions', () => {
  it('accepts 1 to 4 questions with 2 to 4 options and defaults multiSelect to false', () => {
    const r = parseQuestions([{ question: ' Which? ', header: 'Goal', options: [opt('A'), opt('B')] }]);
    expect(r).toEqual({ ok: true, value: [{ question: 'Which?', header: 'Goal', options: [opt('A'), opt('B')], multiSelect: false }] });
    const four = [1, 2, 3, 4].map((n) => q({ question: `Q${n}?`, options: [opt('A'), opt('B'), opt('C'), opt('D')] }));
    expect(parseQuestions(four).ok).toBe(true);
  });

  it('shortens a header over 12 characters instead of refusing the call', () => {
    const r = parseQuestions([q({ header: 'Trust w/o key' })]);
    expect(r.ok && r.value[0].header).toBe('Trust w/o k…');
    expect(shortHeader('Twelve chars')).toBe('Twelve chars');
    expect(shortHeader('Thread access')).toBe('Thread acce…');
    expect(shortHeader('Thread acc  ss')).toBe('Thread acc…');
  });

  it.each([
    ['no questions', []],
    ['five questions', [1, 2, 3, 4, 5].map((n) => q({ question: `Q${n}?` }))],
    ['not a list', { question: 'x' }],
    ['an empty question', [q({ question: '  ' })]],
    ['one option', [q({ options: [opt('A')] })]],
    ['five options', [q({ options: ['A', 'B', 'C', 'D', 'E'].map(opt) })]],
    ['an option without a label', [q({ options: [opt('A'), { label: '', description: 'x' }] })]],
    ['a duplicate option', [q({ options: [opt('A'), opt('A')] })]],
    ['an "Other" option', [q({ options: [opt('A'), opt('Other')] })]],
    ['a duplicate question', [q(), q()]],
    ['a string multiSelect', [{ ...q(), multiSelect: 'yes' }]],
  ])('refuses %s', (_name, raw) => {
    const r = parseQuestions(raw);
    expect(r.ok).toBe(false);
  });
});

describe('parseAnswers', () => {
  const single = q();
  const multi = q({ question: 'Which stores?', multiSelect: true, options: [opt('NL'), opt('DE'), opt('FR')] });

  it('takes one answer per question, null for a skipped one', () => {
    const r = parseAnswers([single, multi], [{ selected: ['Volero'], other: null }, null]);
    expect(r).toEqual({ ok: true, value: [{ selected: ['Volero'], other: null }, null] });
  });

  it('takes several options and Other on a multi select question, in option order', () => {
    const r = parseAnswers([multi], [{ selected: ['FR', 'NL'], other: ' BE ' }]);
    expect(r).toEqual({ ok: true, value: [{ selected: ['NL', 'FR'], other: 'BE' }] });
  });

  it.each([
    ['too few answers', []],
    ['an unknown option', [{ selected: ['Kamera'], other: null }]],
    ['two options on a single choice', [{ selected: ['Acne', 'Volero'], other: null }]],
    ['an option and Other on a single choice', [{ selected: ['Acne'], other: 'Both' }]],
    ['nothing picked', [{ selected: [], other: '  ' }]],
  ])('refuses %s', (_name, raw) => {
    expect(parseAnswers([single], raw).ok).toBe(false);
  });
});

describe('resultText', () => {
  const qs = [q(), q({ question: 'When?', options: [opt('Now'), opt('Later')] })];

  it('names each question and answer, like AskUserQuestion', () => {
    const answers = [{ selected: [], other: 'Pink Gellac' }, null];
    expect(stateOf(answers)).toBe('answered');
    expect(resultText(qs, 'answered', answers)).toBe(
      'User has answered your questions: "Which goal first?"="Pink Gellac", "When?"="skipped, use your best judgement". ' +
        "You can now continue with the user's answers in mind.",
    );
  });

  it('says plainly when the user skipped everything', () => {
    expect(stateOf([null, null])).toBe('skipped');
    expect(resultText(qs, 'skipped', [null, null])).toMatch(/^The user skipped these questions/);
  });
});

describe('questionsIn', () => {
  const asked = { id: 1, kind: 'question', payload: JSON.stringify({ id: 'q1', questions: [q()] }) };
  it('reads a question as pending until its answer event', () => {
    expect(questionsIn([asked])).toEqual([{ id: 'q1', event_id: 1, questions: [q()], state: 'pending', answers: null }]);
    const answer = { id: 9, kind: 'question_answer', payload: { id: 'q1', state: 'answered', answers: [{ selected: ['Acne'], other: null }], via: 'tool' } };
    expect(questionsIn([asked, { id: 5, kind: 'assistant_text', payload: '{}' }, answer])[0]).toMatchObject({ state: 'answered', answers: [{ selected: ['Acne'], other: null }] });
  });
  it('keeps the first answer when two arrive', () => {
    const a = (state: string, id: number) => ({ id, kind: 'question_answer', payload: { id: 'q1', state, answers: null, via: 'tool' } });
    expect(questionsIn([asked, a('dismissed', 2), a('skipped', 3)])[0].state).toBe('dismissed');
  });
});

describe('the card draft', () => {
  const single = q();
  const multi = q({ question: 'Which stores?', multiSelect: true, options: [opt('NL'), opt('DE'), opt('FR')] });

  it('starts with nothing picked, so neither question can advance until Ben chooses', () => {
    const d = newDraft([single, multi]);
    expect(answersOf(d)).toEqual([null, null]);
    expect(canAdvance(d)).toBe(false);
    expect(canAdvance({ ...d, page: 1 })).toBe(false);
    expect(canAdvance({ ...d, picks: [choose(single, d.picks[0], 'Acne'), d.picks[1]] })).toBe(true);
  });

  it('swaps on single choice and toggles on multi select, keeping option order', () => {
    expect(choose(single, newDraft([single]).picks[0], 'Volero').selected).toEqual(['Volero']);
    let p = newDraft([multi]).picks[0];
    p = choose(multi, p, 'FR');
    p = choose(multi, p, 'NL');
    expect(p.selected).toEqual(['NL', 'FR']);
    expect(choose(multi, p, 'FR').selected).toEqual(['NL']);
  });

  it('counts Other only once it has text', () => {
    const p = choose(single, newDraft([single]).picks[0], null);
    expect(answerOf(p)).toBeNull();
    expect(answerOf({ ...p, other: ' Both ' })).toEqual({ selected: [], other: 'Both' });
  });

  it('sends null for a skipped question', () => {
    const d = newDraft([single, multi]);
    expect(answersOf({ ...d, skipped: [true, false] })).toEqual([null, null]);
    expect(parseAnswers([single, multi], answersOf(d)).ok).toBe(true);
  });
});

// The tool itself is Rust (crates/omni-mcp/src/ask.rs), and refuses a call over these limits before the server sees it.
describe('the ask_user_question tool in crates/omni-mcp', () => {
  it('has the limits the server parses with', () => {
    const rust = readFileSync(join(import.meta.dirname, '../../../crates/omni-mcp/src/ask.rs'), 'utf8');
    const constant = (name: string) => Number(new RegExp(`const ${name}: u32 = (\\d+);`).exec(rust)?.[1]);
    expect(['QUESTIONS_MAX', 'OPTIONS_MIN', 'OPTIONS_MAX', 'HEADER_MAX'].map(constant)).toEqual([QUESTIONS_MAX, OPTIONS_MIN, OPTIONS_MAX, HEADER_MAX]);
  });
});
