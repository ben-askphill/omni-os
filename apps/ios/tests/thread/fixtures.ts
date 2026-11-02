import type { HarnessInfo, Thread, ThreadStub } from '@omni/client-core';

export function thread(over: Partial<Thread> = {}): Thread {
  return {
    id: 't1',
    channel_id: 'c1',
    title: 'Fix the build',
    status: 'done',
    folder_id: null,
    parent_id: null,
    pinned_at: null,
    done_at: null,
    archived: 0,
    harness: 'claude',
    model: 'sonnet',
    effort: '',
    auto_reason: null,
    queued_harness: null,
    queued_model: null,
    queued_effort: null,
    created_at: '2026-11-02T10:00:00Z',
    updated_at: '2026-11-02T10:00:00Z',
    ...over,
  } as unknown as Thread;
}

export function stub(over: Partial<ThreadStub> = {}): ThreadStub {
  return {
    id: 't1',
    channel_id: 'c1',
    title: 'Fix the build',
    status: 'done',
    folder_id: null,
    parent_id: null,
    pinned_at: null,
    done_at: null,
    harness: 'claude',
    source: 'manual',
    created_at: '2026-11-02T10:00:00Z',
    updated_at: '2026-11-02T10:00:00Z',
    ...over,
  } as unknown as ThreadStub;
}

/** Two available harnesses and one that is down, as `/harnesses` answers: nothing here names a harness the code knows. */
export function catalog(): HarnessInfo[] {
  return [
    {
      id: 'claude',
      name: 'Claude Code',
      plan: 'Claude plan',
      available: true,
      cap: 4,
      running: 0,
      capabilities: {},
      models: [
        { id: 'sonnet', label: 'Sonnet 5.5', note: 'Fast', default: true, efforts: ['low', 'high'], defaultEffort: 'low' },
        { id: 'opus', label: 'Opus 5.5', note: '', efforts: ['low', 'high'], defaultEffort: 'high' },
      ],
    },
    {
      id: 'codex',
      name: 'Codex',
      plan: 'ChatGPT plan',
      available: true,
      cap: 4,
      running: 0,
      capabilities: {},
      models: [{ id: 'gpt', label: 'GPT', note: '', default: true, efforts: [], defaultEffort: '' }],
    },
    {
      id: 'hermes',
      name: 'Hermes',
      plan: 'Local',
      available: false,
      fix: 'hermes login',
      cap: 1,
      running: 0,
      capabilities: {},
      models: [],
    },
  ] as unknown as HarnessInfo[];
}
