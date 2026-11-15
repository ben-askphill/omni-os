import { describe, expect, it } from 'vitest';
import { api, at } from './api-helpers.ts';

describe('tasks', () => {
  it('reads the live background tasks', async () => {
    const tasks = [{ thread_id: 't1', channel_id: 'c', task_id: 'k1', description: 'Read the theme', subagent: true, background: true, started_at: '2026-11-15T21:00:00Z' }];
    const call = api({ json: tasks });
    expect(await call.api.tasks()).toEqual(tasks);
    expect(call.sent).toEqual([{ method: 'GET', url: at('/tasks') }]);
  });
});
