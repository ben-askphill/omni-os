import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Which of the phone's delivered alerts are settled, so the app clears them from Notification Center: read after the
// alert was sent (here or on the other Mac), a question answered, a thread archived or marked done. Never one this
// server does not know, never while the thread runs or still waits on Ben. POST /api/auth/push-settled.

const H = await startRunner();
const { app } = await import('../app.ts');
const { askQuestion, dismissQuestions } = await import('../runner/questions.ts');
const { settledAlerts } = await import('../push-settled.ts');
type Ref = import('@omni/shared/app-pairing.ts').AppPushAlertRef;

const T = { timeout: 20_000 };
const Q = { question: 'Ship it?', header: 'Ship', options: [{ label: 'Yes', description: 'Now.' }, { label: 'No', description: 'Later.' }], multiSelect: false };

const req = (path: string, body: unknown, token: string | null) =>
  app.request(`http://127.0.0.1:4747/api${path}`, {
    method: 'POST',
    headers: { host: '127.0.0.1:4747', 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** A thread whose first turn finished: its result waits unread in Needs you. */
async function finished(prompt: string) {
  const t = await H.start(prompt);
  await H.untilResults(t.id, 1);
  return t.id;
}
const unreadUid = (threadId: string) => H.db.needsYou(undefined, threadId).items[0]!.result!.uid;
const alert = (threadId: string, kind: Ref['kind'], at = new Date().toISOString()): Ref => ({ id: `n-${threadId}-${kind}`, kind, threadId, at });

describe('which alerts are settled', () => {
  it('clears a finished or PR alert once the result is read after it, and not before', T, async () => {
    const id = await finished('fix the build');
    const sent = [alert(id, 'finished'), alert(id, 'prAttention')];
    expect(settledAlerts(sent)).toEqual([]);
    H.db.resultReads.read(unreadUid(id));
    expect(settledAlerts(sent)).toEqual(sent.map((a) => a.id));
  });

  it('keeps an alert sent after the last read: that read was of something older', T, async () => {
    const id = await finished('watch the PR');
    H.db.resultReads.read(unreadUid(id));
    expect(settledAlerts([alert(id, 'prAttention', new Date(Date.now() + 60_000).toISOString())])).toEqual([]);
  });

  it('keeps a PR alert while the wake runs and its result waits, and clears it once that result is read', T, async () => {
    const id = await finished('fix ci');
    H.db.resultReads.read(unreadUid(id));
    const sent = alert(id, 'prAttention');
    // The wake: the thread runs, then ends with a new result (threads_completion writes it).
    H.db.threads.update(id, { status: 'running' });
    expect(settledAlerts([sent])).toEqual([]);
    H.db.threads.update(id, { status: 'done' });
    expect(settledAlerts([sent])).toEqual([]);
    H.db.resultReads.read(unreadUid(id));
    expect(settledAlerts([sent])).toEqual([sent.id]);
  });

  it('clears a question once it is answered, wherever', T, async () => {
    const id = await finished('ask me');
    askQuestion(id, [Q]);
    const sent = alert(id, 'needsInput');
    expect(settledAlerts([sent])).toEqual([]);
    dismissQuestions(id);
    expect(settledAlerts([sent])).toEqual([sent.id]);
  });

  it('clears any alert of a thread archived or marked done', T, async () => {
    const a = await finished('archive me');
    const d = await finished('done with me');
    H.db.threads.update(a, { archived: 1 });
    H.db.threads.setDone(d, true);
    expect(settledAlerts([alert(a, 'failed'), alert(d, 'crewReport')])).toEqual([`n-${a}-failed`, `n-${d}-crewReport`]);
  });

  it('never clears an alert for a thread this server does not have', () => {
    expect(settledAlerts([alert('on-another-server', 'finished', '2000-01-01T00:00:00Z')])).toEqual([]);
  });
});

describe('POST /api/auth/push-settled', () => {
  async function pairApp() {
    const { code } = (await (await req('/auth/app-pairings', {}, process.env.OMNI_TOKEN!)).json()) as { code: string };
    return ((await (await req('/auth/app-pairings/redeem', { code, name: 'phone' }, null)).json()) as { token: string }).token;
  }

  it('answers an app session with the settled ids', T, async () => {
    const token = await pairApp();
    const id = await finished('read me');
    H.db.resultReads.read(unreadUid(id));
    const res = await req('/auth/push-settled', { alerts: [alert(id, 'finished', '2000-01-01T00:00:00Z'), alert('elsewhere', 'finished')] }, token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ settled: [`n-${id}-finished`] });
  });

  it('refuses a malformed body and anyone but an app session', async () => {
    const token = await pairApp();
    for (const body of [{}, { alerts: [{ id: 'x', kind: 'other', threadId: 't', at: '2026-01-01T00:00:00Z' }] }, { alerts: [{ id: 'x', kind: 'failed', threadId: 't', at: 'soon' }] }, 'nope']) {
      expect((await req('/auth/push-settled', body, token)).status).toBe(400);
    }
    expect((await req('/auth/push-settled', { alerts: [] }, process.env.OMNI_TOKEN!)).status).toBe(403);
  });
});
