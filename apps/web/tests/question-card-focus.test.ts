// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Question, ThreadQuestion } from '@omni/shared/question.ts';

// The question card in a live DOM (U9): it must not take focus from the reply box, and Cmd+Enter must not answer for Ben.

const posts: { path: string; body: unknown }[] = [];
vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.post = vi.fn(async (path: string, body: unknown) => {
    posts.push({ path, body });
    return { state: 'answered' };
  }) as typeof actual.api.post;
  return actual;
});

import { QuestionCard, typingElsewhere } from '../src/components/thread/QuestionCard.tsx';

const DB: Question = {
  question: 'Which database should the cache use?',
  options: [
    { label: 'Postgres', description: '' },
    { label: 'Redis', description: '' },
  ],
  multiSelect: false,
};
const pending: ThreadQuestion = { id: 'q1', event_id: 3, questions: [DB], state: 'pending', answers: null };

let host: HTMLDivElement;
let root: Root;
let composer: HTMLTextAreaElement;

beforeEach(() => {
  posts.length = 0;
  composer = document.createElement('textarea');
  document.body.append(composer);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

const mount = () => act(() => root.render(createElement(QuestionCard, { threadId: 't', q: pending })));
const card = () => host.querySelector('section[aria-label="Question from the agent"]') as HTMLElement;
const radios = () => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
const cmdEnter = (target: Element) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
  });

describe('the question card and focus', () => {
  it('leaves focus in the reply box when it appears while Ben types', () => {
    composer.focus();
    mount();
    expect(document.activeElement).toBe(composer);
  });

  it('takes focus on its first row when nobody is typing', () => {
    mount();
    expect(document.activeElement).toBe(radios()[0]);
  });

  it('sends nothing on Cmd+Enter until Ben picks an option', async () => {
    mount();
    expect(radios().every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);
    await cmdEnter(card());
    expect(posts).toEqual([]);

    act(() => radios()[1].click());
    await cmdEnter(radios()[1]);
    expect(posts).toEqual([{ path: '/threads/t/questions/q1/answer', body: { answers: [{ selected: ['Redis'], other: null }] } }]);
  });
});

describe('typingElsewhere', () => {
  const el = (html: string) => {
    const box = document.createElement('div');
    box.innerHTML = html;
    document.body.append(box);
    return box.firstElementChild as HTMLElement;
  };

  it('counts text fields, selects and editable regions outside the card', () => {
    const inside = el('<section><input /></section>');
    expect(typingElsewhere(el('<textarea></textarea>'), inside)).toBe(true);
    expect(typingElsewhere(el('<input type="search" />'), inside)).toBe(true);
    expect(typingElsewhere(el('<input />'), inside)).toBe(true);
    expect(typingElsewhere(el('<select></select>'), inside)).toBe(true);
    expect(typingElsewhere(el('<div contenteditable="true"></div>'), inside)).toBe(true);
  });

  it('ignores buttons, checkboxes, the page body and fields inside the card', () => {
    const inside = el('<section><input /></section>');
    expect(typingElsewhere(el('<button>x</button>'), inside)).toBe(false);
    expect(typingElsewhere(el('<input type="checkbox" />'), inside)).toBe(false);
    expect(typingElsewhere(document.body, inside)).toBe(false);
    expect(typingElsewhere(null, inside)).toBe(false);
    expect(typingElsewhere(inside.querySelector('input'), inside)).toBe(false);
  });
});
