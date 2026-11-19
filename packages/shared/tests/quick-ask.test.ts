import { describe, expect, it } from 'vitest';
import { quickAskKey, quickTurns, readsOnly, taskPrompt, taskRequest } from '../quick-ask.ts';

const key = (k: Partial<Parameters<typeof quickAskKey>[0]>) => quickAskKey({ key: 'Enter', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...k });

describe('quick ask rules', () => {
  it("reads the agent's TASK line only as the answer's first line", () => {
    expect(taskRequest('TASK: Rename the cart drawer\nIt edits files.\nFound: drawer.liquid')).toEqual({ title: 'Rename the cart drawer', reason: 'It edits files.\nFound: drawer.liquid' });
    expect(taskRequest('\n  TASK: "Fix checkout".\n')).toEqual({ title: 'Fix checkout', reason: '' });
    expect(taskRequest('The answer is 4.\nTASK: not this')).toBeNull();
    expect(taskRequest('TASK:   ')).toBeNull();
    expect(taskRequest(null)).toBeNull();
  });

  it("starts the task from what was asked and answered, leaving out the TASK answer", () => {
    const turns = quickTurns([
      { kind: 'user', payload: JSON.stringify({ text: 'Which theme is live?' }) },
      { kind: 'assistant_text', payload: { text: 'Dawn 15.' } },
      { kind: 'user', payload: { text: 'Update it to 16' } },
      { kind: 'assistant_text', payload: { text: 'TASK: Update Dawn\nIt changes the store.' } },
    ]);
    expect(turns).toEqual([
      { question: 'Which theme is live?', answer: 'Dawn 15.' },
      { question: 'Update it to 16', answer: 'TASK: Update Dawn\nIt changes the store.' },
    ]);
    const prompt = taskPrompt(turns);
    expect(prompt.startsWith('Update it to 16\n\nThis started as a quick ask.')).toBe(true);
    expect(prompt).toContain('> **Answer:** Dawn 15.');
    expect(prompt).not.toContain('TASK:');
    expect(taskPrompt([{ question: 'Just this', answer: null }])).toBe('Just this');
    expect(taskPrompt(turns, 'Do the upgrade')).toMatch(/^Do the upgrade\n/);
  });

  it('asks on Return, makes a task on Shift-Return, and opens it with Cmd or Ctrl', () => {
    expect(key({})).toBe('ask');
    expect(key({ shiftKey: true })).toBe('task');
    expect(key({ metaKey: true })).toBe('task-open');
    expect(key({ ctrlKey: true })).toBe('task-open');
    expect(key({ altKey: true })).toBeNull();
    expect(key({ isComposing: true })).toBeNull();
    expect(key({ key: 'a' })).toBeNull();
  });
});

describe('quickAskView', () => {
  const ev = (kind: string, payload: object) => ({ kind, payload });
  it('reads the turns, whether it is answering, and what it turned into', async () => {
    const { quickAskView } = await import('../quick-ask.ts');
    const events = [ev('user', { text: 'q' }), ev('assistant_text', { text: 'a' })];
    expect(quickAskView({ status: 'running', quick: 1 }, events)).toMatchObject({ busy: true, copy: null, promoted: null, kept: false });
    expect(quickAskView({ status: 'done', quick: 1 }, events)).toMatchObject({ busy: false, copy: 'a', kept: false });
    expect(quickAskView({ status: 'done', quick: 0 }, events).kept).toBe(true);
    const made = quickAskView({ status: 'done', quick: 0, promoted_to: 't2' }, [...events, ev('task_suggested', { title: 'Do it', reason: '' }), ev('promoted', { thread_id: 't2', title: 'Do it' })]);
    expect(made).toMatchObject({ kept: false, suggested: null, promoted: { thread_id: 't2', title: 'Do it' } });
  });

  it("shows the agent's suggested task until Ben asks something else", async () => {
    const { quickAskView } = await import('../quick-ask.ts');
    const asked = [ev('user', { text: 'rename it' }), ev('assistant_text', { text: 'TASK: Rename it' }), ev('task_suggested', { title: 'Rename it', reason: 'It edits files.' })];
    expect(quickAskView({ status: 'done', quick: 1 }, asked).suggested).toEqual({ title: 'Rename it', reason: 'It edits files.' });
    expect(quickAskView({ status: 'running', quick: 1 }, [...asked, ev('user', { text: 'never mind' })]).suggested).toBeNull();
  });

  it('keeps a kept ask read-only', () => {
    expect(readsOnly({ quick: 1, workspace: 'read' })).toBe(true);
    expect(readsOnly({ quick: 0, workspace: 'read' })).toBe(true);
    expect(readsOnly({ quick: 0, workspace: 'none' })).toBe(true);
    expect(readsOnly({ quick: 0, workspace: 'worktree' })).toBe(false);
    expect(readsOnly({ quick: 0, workspace: null })).toBe(false);
  });
});
