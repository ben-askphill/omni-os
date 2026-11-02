import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Which thread events alert the phone. The rules live in push-sender.ts; the question hook is exercised through
// askQuestion, the same call the ask_user_question route makes.

const r = await startRunner();
const { askQuestion } = await import('../runner/questions.ts');
const { failSetup } = await import('../runner/setup.ts');
const { installPushSender, noopPushSender, notifyCrewReport, notifyEnded } = await import('../push-sender.ts');
type PushEvent = import('../push-sender.ts').PushEvent;
type ThreadStatus = import('../db.ts').ThreadStatus;

const Q = {
  question: 'Which Q4 goal should get the most of your time?',
  header: 'Q4 focus',
  options: [
    { label: 'Acne POC', description: 'Prove the move on one market.' },
    { label: 'Volero hypercare', description: 'Stay close while orders ramp up.' },
  ],
  multiSelect: false,
};

let sent: PushEvent[] = [];
beforeEach(() => {
  sent = [];
  installPushSender({ configured: true, send: (event) => void sent.push(event) });
});
afterEach(() => installPushSender(noopPushSender));

let n = 0;
function thread(over: { channel?: string; parent?: string | null } = {}) {
  const id = `trigger-${++n}`;
  r.db.threads.create({
    id,
    channel_id: over.channel ?? 'scratch',
    title: id,
    status: 'done',
    role: null,
    model: null,
    session_id: id,
    cwd: r.tmp,
    branch: null,
    parent_id: over.parent ?? null,
    task_id: null,
    source: 'manual',
    automation: null,
  });
  return id;
}

describe('a thread needs input', () => {
  it('alerts when the agent asks a question, with the thread and its channel', () => {
    const id = thread({ channel: 'scratch' });
    askQuestion(id, [Q]);
    expect(sent).toEqual([{ kind: 'needsInput', threadId: id, channelId: 'scratch' }]);
  });
});

describe('a turn ends', () => {
  it('alerts when a thread finishes', () => {
    const id = thread();
    notifyEnded(id, 'done');
    expect(sent).toEqual([{ kind: 'finished', threadId: id, channelId: 'scratch' }]);
  });

  it('alerts when a thread fails', () => {
    const id = thread();
    notifyEnded(id, 'failed');
    expect(sent).toEqual([{ kind: 'failed', threadId: id, channelId: 'scratch' }]);
  });

  it('stays quiet for a thread Ben stopped or one that is queued', () => {
    const id = thread();
    for (const status of ['stopped', 'queued', 'running'] as ThreadStatus[]) notifyEnded(id, status);
    expect(sent).toEqual([]);
  });

  it('skips a finished child, which its parent already hears about, but alerts when a child fails', () => {
    const parent = thread();
    const child = thread({ parent });
    notifyEnded(child, 'done');
    expect(sent).toEqual([]);
    notifyEnded(child, 'failed');
    expect(sent).toEqual([{ kind: 'failed', threadId: child, channelId: 'scratch' }]);
  });
});

describe('a thread that could not be prepared', () => {
  it('alerts as failed when its worktree cannot be made', () => {
    const id = thread();
    failSetup(id, 'git worktree add failed');
    expect(sent).toEqual([{ kind: 'failed', threadId: id, channelId: 'scratch' }]);
  });

  it('stays quiet when Ben stopped it while it was being prepared', () => {
    failSetup(thread(), 'stopped', true);
    expect(sent).toEqual([]);
  });
});

describe('a crew report', () => {
  it('alerts when it lands in the Conductor', () => {
    const conductorThread = thread({ channel: 'conductor' });
    notifyCrewReport(conductorThread);
    expect(sent).toEqual([{ kind: 'crewReport', threadId: conductorThread, channelId: 'conductor' }]);
  });

  it('does not alert for a report that lands in another channel', () => {
    notifyCrewReport(thread({ channel: 'scratch' }));
    expect(sent).toEqual([]);
  });
});
