import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Question, ThreadQuestion } from '@omni/shared/question.ts';
import type { NeedsYouItem, Thread } from '../src/api.ts';
import { QuestionCard } from '../src/components/thread/QuestionCard.tsx';
import { needsCard } from '../src/mobile/activity.ts';
import { threadView } from '@omni/shared/thread-view.ts';
import { reasonOf } from '../src/needs-you.ts';
import { buildItems, isAsking, type TranscriptEvent } from '@omni/shared/transcript-fold.ts';

// The question card (ask_user_question) in the Web UI: the card itself, where the fold puts it, and Needs you.

const DB: Question = {
  question: 'Which database should the cache use?',
  header: 'Storage',
  options: [
    { label: 'Postgres', description: 'The one the app already runs' },
    { label: 'Redis', description: 'Faster, one more service' },
  ],
  multiSelect: false,
};
const LOCALES: Question = {
  question: 'Which locales ship first?',
  options: [
    { label: 'Dutch', description: 'nl-NL' },
    { label: 'German', description: 'de-DE' },
    { label: 'French', description: 'fr-FR' },
  ],
  multiSelect: true,
};

const pending = (questions: Question[]): ThreadQuestion => ({ id: 'q1', event_id: 3, questions, state: 'pending', answers: null });
const html = (q: ThreadQuestion, touch = false) => renderToStaticMarkup(createElement(QuestionCard, { threadId: 't', q, touch }));
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('the question card, pending', () => {
  it('asks a single choice question as radios with Other, first page of two', () => {
    const out = html(pending([DB, LOCALES]));
    expect(out).toContain('Which database should the cache use?');
    expect(out).toContain('Storage');
    expect(out).toContain('role="radiogroup"');
    expect(count(out, 'role="radio"')).toBe(3);
    expect(out).toContain('Other');
    expect(out).toContain('The one the app already runs');
    // A single choice question starts on its first option.
    expect(out).toMatch(/role="radio" aria-checked="true"[^>]*>.*?Postgres/);
    expect(out).toContain('1 of 2');
    expect(out).toContain('Next');
    expect(out).not.toContain('Send');
    expect(out).toContain('Skip');
    expect(out).toContain('Needs your input');
    // Only the page shown.
    expect(out).not.toContain('Which locales ship first?');
  });

  it('asks a multi select question as checkboxes, and a lone question sends without a pager', () => {
    const out = html(pending([LOCALES]));
    expect(out).toContain('role="group"');
    expect(count(out, 'role="checkbox"')).toBe(4);
    expect(out).not.toContain('aria-checked="true"');
    expect(out).toContain('Send');
    expect(out).not.toContain('Next');
    expect(out).not.toContain('Previous question');
    // Nothing picked yet: Send waits.
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Send/);
  });

  it('shows the keyboard hint on desktop only', () => {
    expect(html(pending([DB]))).toContain('⌘↵');
    expect(html(pending([DB]), true)).not.toContain('⌘↵');
  });
});

describe('the question card, settled', () => {
  it('folds an answer to its words, with no buttons', () => {
    const out = html({ ...pending([DB, LOCALES]), state: 'answered', answers: [{ selected: [], other: 'SQLite, it is local' }, { selected: ['Dutch', 'German'], other: null }] });
    expect(out).toContain('Answered');
    expect(out).toContain('Which database should the cache use?');
    expect(out).toContain('SQLite, it is local');
    expect(out).toContain('Dutch, German');
    expect(out).not.toContain('<button');
    expect(out).not.toContain('Needs your input');
  });

  it('says skipped and not answered', () => {
    const skipped = html({ ...pending([DB]), state: 'skipped', answers: [null] });
    expect(skipped).toContain('Skipped');
    expect(skipped).not.toContain('<button');
    const dismissed = html({ ...pending([DB]), state: 'dismissed', answers: null });
    expect(dismissed).toContain('Not answered');
    expect(dismissed).toContain('Which database should the cache use?');
    expect(dismissed).not.toContain('<button');
  });
});

let id = 0;
const ev = (kind: string, payload: unknown): TranscriptEvent => ({ id: ++id, kind, payload: JSON.stringify(payload), created_at: `2026-10-24T10:00:${String(id).padStart(2, '0')}.000Z` });
const ASK = 'mcp__omni-ask__ask_user_question';

function asked(answered: boolean) {
  id = 0;
  return [
    ev('user', { text: 'Add a cache' }),
    ev('tool_use', { id: 'r', name: 'Read', input: { file_path: '/w/app.ts' } }),
    ev('tool_result', { tool_use_id: 'r', text: 'ok', is_error: false, truncated: false }),
    ev('tool_use', { id: 'ask', name: ASK, input: { questions: [DB] } }),
    ev('question', { id: 'q1', questions: [DB] }),
    ...(answered
      ? [
          ev('question_answer', { id: 'q1', state: 'answered', answers: [{ selected: ['Redis'], other: null }], via: 'tool' }),
          ev('tool_result', { tool_use_id: 'ask', text: 'User has answered', is_error: false, truncated: false }),
          ev('tool_use', { id: 'e', name: 'Edit', input: { file_path: '/w/app.ts' } }),
          ev('assistant_text', { text: 'Redis it is.' }),
        ]
      : []),
  ];
}

describe('the transcript fold', () => {
  it('puts the card where the question was asked and leaves out the tool call', () => {
    const { items } = buildItems(asked(true));
    expect(items.map((i) => i.type)).toEqual(['user', 'tools', 'question', 'tools', 'text']);
    const tools = items.filter((i) => i.type === 'tools');
    expect(tools.flatMap((t) => t.calls.map((c) => c.name))).toEqual(['Read', 'Edit']);
    expect(tools.map((t) => t.total)).toEqual([1, 1]);
    const q = items.find((i) => i.type === 'question');
    expect(q).toMatchObject({ q: { id: 'q1', state: 'answered', answers: [{ selected: ['Redis'], other: null }] } });
  });

  it('knows when the thread waits on an answer', () => {
    expect(isAsking(asked(false))).toBe(true);
    expect(isAsking(asked(true))).toBe(false);
  });
});

describe('the phone thread', () => {
  it('shows the card in its turn, counts no step for it and is not busy while it waits', () => {
    const v = threadView({ events: asked(false), thread: { status: 'running', cwd: '/w', harness: 'claude-code' }, artifacts: [], children: [] });
    expect(v.turns).toHaveLength(1);
    expect(v.turns[0].questions.map((q) => [q.id, q.state])).toEqual([['q1', 'pending']]);
    expect(v.turns[0].steps).toBe(1);
    expect(v.asking).toBe(true);
    expect(v.now).toBeNull();
  });
});

describe('Needs you', () => {
  const item = (count: number): NeedsYouItem => ({
    thread: { id: 't', title: 'Add a cache', channel_id: 'acme', status: 'running', harness: 'claude', last_text: null } as unknown as Thread,
    result: null,
    blockers: [{ kind: 'question', detail: DB.question, count }],
    at: '2026-10-24T10:00:00.000Z',
  });

  it('lists a thread that waits on an answer, with the question', () => {
    expect(reasonOf(item(1))).toEqual({ glyph: 'needs', label: 'Waiting on your answer', detail: DB.question });
    expect(reasonOf(item(2)).label).toBe('2 questions wait on your answer');
  });

  it('opens the thread to answer it from the phone', () => {
    const card = needsCard(item(1), undefined, () => 'Claude Code', Date.parse('2026-10-24T10:05:00.000Z'));
    expect(card.actions[0]).toEqual({ kind: 'open', label: 'Answer' });
    expect(card.label).toBe('Waiting on your answer');
  });
});
