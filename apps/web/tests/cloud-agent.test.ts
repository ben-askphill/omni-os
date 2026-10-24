import { describe, expect, it } from 'vitest';
import { CLOUD_STATUS, cloudAgentUrl, cloudStatus, prNumber } from '../src/cloud-agent.ts';
import { harnessesPath } from '../src/api.ts';
import { threadView } from '../src/mobile/thread-view.ts';
import type { Thread } from '../src/api.ts';
import type { TranscriptEvent } from '../src/transcript/fold.ts';

describe('cloud agent card', () => {
  it('says each run status in words, with the thread status its pill draws', () => {
    expect(Object.fromEntries(Object.entries(CLOUD_STATUS).map(([k, v]) => [k, `${v.status}:${v.label}`]))).toEqual({
      CREATING: 'queued:Starting',
      RUNNING: 'running:Working',
      FINISHED: 'done:Finished',
      ERROR: 'failed:Error',
      CANCELLED: 'stopped:Stopped',
      EXPIRED: 'failed:Expired',
    });
    expect(cloudStatus('SOMETHING_NEW').label).toBe('Working');
  });

  it('reads the PR number from a GitHub pull request URL only', () => {
    expect(prNumber('https://github.com/acme/widgets/pull/42')).toBe('#42');
    expect(prNumber('https://github.com/acme/widgets/pull/42/files')).toBe('#42');
    expect(prNumber('https://github.com/acme/widgets/pull/42?x=1')).toBe('#42');
    expect(prNumber('https://github.com/acme/widgets/pulls')).toBeNull();
    expect(prNumber('https://github.com/acme/widgets/pull/4x')).toBeNull();
    expect(prNumber(undefined)).toBeNull();
  });

  it('links the agent only once the session id is one', () => {
    expect(cloudAgentUrl('bc-6f1c2d3e-4a5b-4c6d-8e7f-901234567890')).toBe('https://cursor.com/agents/bc-6f1c2d3e-4a5b-4c6d-8e7f-901234567890');
    expect(cloudAgentUrl('3f0a1b2c-0000-4000-8000-000000000000')).toBeNull();
  });

  it('asks for the harnesses as a channel sees them', () => {
    expect(harnessesPath('acme widgets')).toBe('/harnesses?channel=acme%20widgets');
    expect(harnessesPath(undefined)).toBe('/harnesses');
  });
});

describe('phone turn with a cloud agent', () => {
  const ev = (id: number, kind: string, payload: unknown): TranscriptEvent => ({ id, kind, payload: JSON.stringify(payload), created_at: '2026-10-24T08:00:00.000Z' });
  const base = { agent_id: 'bc-1', url: 'https://cursor.com/agents/bc-1', repo: 'acme/widgets', run_id: 'run-1' };

  it('keeps the run newest state on its turn and says what it is doing while it runs', () => {
    const events = [
      ev(1, 'user', { text: 'Move the buttons' }),
      ev(2, 'cloud_agent', { ...base, status: 'CREATING' }),
      ev(3, 'cloud_agent', { ...base, status: 'RUNNING', branch: 'cursor/move' }),
    ];
    const v = threadView({ events, thread: { status: 'running', cwd: '', harness: 'cursor-cloud' } as Pick<Thread, 'status' | 'cwd' | 'harness'>, artifacts: [], children: [] });
    expect(v.turns).toHaveLength(1);
    expect(v.turns[0].cloud).toMatchObject({ status: 'RUNNING', branch: 'cursor/move' });
    expect(v.now).toEqual({ verb: 'Cursor cloud agent: working', target: '' });
  });
});
