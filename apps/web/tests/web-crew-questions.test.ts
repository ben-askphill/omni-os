import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CrewQuestion } from '@omni/shared/question.ts';
import { CrewQuestionList } from '../src/components/thread/CrewQuestions.tsx';

// A delegated thread's question on the thread that delegated it (GET /threads/:id/crew-questions).

const asked = (thread_id: string, task_id: string | null, thread_title: string, id: string): CrewQuestion => ({
  thread_id,
  thread_title,
  task_id,
  channel_id: 'shop',
  question: {
    id,
    event_id: 1,
    questions: [{ question: `Which market goes first for ${thread_title}?`, options: [{ label: 'NL', description: '' }, { label: 'DE', description: '' }], multiSelect: false }],
    state: 'pending',
    answers: null,
  },
});
const html = (items: CrewQuestion[], touch = false) => renderToStaticMarkup(createElement(CrewQuestionList, { items, touch }));

describe('questions from delegated threads', () => {
  it('shows each pending card under the thread and task that asked it, linked to that thread', () => {
    const out = html([asked('child-1', 'T-AB12', 'Build the export', 'q1'), asked('member-1', 'T-CD34.2', 'Write the copy', 'q2')]);
    expect(out).toContain('T-AB12 · Build the export asks');
    expect(out).toContain('href="#/t/child-1"');
    expect(out).toContain('T-CD34.2 · Write the copy asks');
    expect(out).toContain('Which market goes first for Build the export?');
    expect(out).toContain('Which market goes first for Write the copy?');
    expect(out.split('role="radiogroup"').length - 1).toBe(2);
    expect(out).toContain('Needs your input');
  });

  it('labels a thread without a task id by its title, with phone-sized targets on touch', () => {
    const out = html([asked('child-2', null, 'Check the stock', 'q3')], true);
    expect(out).toContain('>Check the stock asks<');
    expect(out).toContain('min-h-11');
    expect(out).not.toContain('⌘↵');
  });
});
