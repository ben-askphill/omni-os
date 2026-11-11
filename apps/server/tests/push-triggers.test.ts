import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Which thread events alert the phone. The rules live in push-sender.ts; the question hook is exercised through
// askQuestion, the same call the ask_user_question route makes.

const r = await startRunner();
const { askQuestion } = await import('../runner/questions.ts');
const { failSetup } = await import('../runner/setup.ts');
const { alertFor, installPushSender, noopPushSender, notifyCrewReport, notifyEnded } = await import('../push-sender.ts');
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
  installPushSender({ configured: true, send: (event) => void sent.push(event), close() {} });
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
    expect(sent).toEqual([{ kind: 'needsInput', threadId: id, channelId: 'scratch', title: id, text: Q.question }]);
  });
});

describe('a turn ends', () => {
  it('alerts when a thread finishes, with its title and reply', () => {
    const id = thread();
    notifyEnded(id, 'done', 'All three surfaces pass.');
    expect(sent).toEqual([{ kind: 'finished', threadId: id, channelId: 'scratch', title: id, text: 'All three surfaces pass.' }]);
  });

  it('alerts when a thread fails', () => {
    const id = thread();
    notifyEnded(id, 'failed');
    expect(sent).toEqual([{ kind: 'failed', threadId: id, channelId: 'scratch', title: id, text: null }]);
  });

  it('previews the last reply of the turn, not the narration before it', () => {
    const id = thread();
    r.db.events.add(id, 'user', { text: 'Fix it' });
    r.db.events.add(id, 'assistant_text', { text: 'Let me look at the sender.' });
    r.db.events.add(id, 'tool_use', { id: 'tu1', name: 'Read', input: {} });
    r.db.events.add(id, 'assistant_text', { text: 'Fixed: alerts now show a preview.' });
    expect(r.db.events.lastRunReply(id)).toBe('Fixed: alerts now show a preview.');
    r.db.events.add(id, 'user', { text: 'Thanks' });
    expect(r.db.events.lastRunReply(id)).toBe('');
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
    expect(sent).toEqual([{ kind: 'failed', threadId: child, channelId: 'scratch', title: child, text: null }]);
  });
});

describe('a live turn', () => {
  it('alerts with the thread title and the reply the turn ended on, as plain text', async () => {
    const t = await r.start('RICH and **bold** with a [link](https://example.com)');
    await r.untilResults(t.id, 1);
    const finished = sent.filter((e) => e.threadId === t.id && e.kind === 'finished');
    expect(finished).toHaveLength(1);
    const replies = r.texts(t.id, 'assistant_text');
    expect(finished[0].text).toBe(replies.at(-1));
    expect(alertFor(finished[0])).toEqual({
      title: r.thread(t.id).title,
      subtitle: 'Finished',
      body: 'ack: RICH and bold with a link',
    });
  });
});

describe('a thread that could not be prepared', () => {
  it('alerts as failed when its worktree cannot be made', () => {
    const id = thread();
    failSetup(id, 'git worktree add failed');
    expect(sent).toEqual([
      { kind: 'failed', threadId: id, channelId: 'scratch', title: id, text: "Omni could not prepare this thread's worktree: git worktree add failed" },
    ]);
  });

  it('stays quiet when Ben stopped it while it was being prepared', () => {
    failSetup(thread(), 'stopped', true);
    expect(sent).toEqual([]);
  });
});

describe('a crew report', () => {
  it('alerts when it lands in the Conductor', () => {
    const conductorThread = thread({ channel: 'conductor' });
    notifyCrewReport(conductorThread, { text: 'PR opened.', title: 'Fix push previews', status: 'done' });
    expect(sent).toEqual([
      { kind: 'crewReport', threadId: conductorThread, channelId: 'conductor', title: conductorThread, text: 'PR opened.', from: 'Fix push previews' },
    ]);
  });

  it('does not alert for a report that lands in another channel', () => {
    notifyCrewReport(thread({ channel: 'scratch' }));
    expect(sent).toEqual([]);
  });
});
