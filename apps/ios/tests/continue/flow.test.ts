import type { Carryover, ContinueBlock, ContinuePreview } from '@omni/shared/continue.ts';
import {
  blockOf,
  CHANGED_NOTE,
  canStart,
  closesTerminal,
  continueReducer,
  continueTargets,
  defaultRun,
  initContinue,
  refusalText,
  shownPreview,
  type ContinueAction,
  type ContinueSource,
  type ContinueState,
} from '@omni/shared/continue-flow.ts';
import { describe, expect, it, vi } from 'vitest';

import { closeSourceTerminal, loadPreview, loadSource, pickerModel, runFor, startContinue, startFailure, type ContinueApi } from '../../src/continue/flow';
import { SIGNED_OUT_ERROR } from '../../src/failure';
import { refusal, unreachable } from '../machine/fixtures';
import { catalog, thread } from '../thread/fixtures';

const SOURCE: ContinueSource = { id: 't1', title: 'Fix the build', harness: 'claude', channel_id: 'c1' };

function carryover(over: Partial<Carryover> = {}): Carryover {
  return {
    source: { id: 't1', title: 'Fix the build', channel: 'c1', run: { harness: 'claude', model: 'sonnet', effort: '', harnessName: 'Claude Code', modelLabel: 'Sonnet 5.5' } },
    to: { harness: 'codex', model: 'gpt', effort: '', harnessName: 'Codex', modelLabel: 'GPT' },
    goal: 'Fix the build',
    constraints: [],
    files: null,
    checks: [],
    recent: [],
    attachments: [],
    omitted: [],
    budget: 24000,
    chars: 1200,
    text: 'Carryover text',
    ...over,
  };
}

const preview = (revision = 'r1', over: Partial<ContinuePreview> = {}): ContinuePreview => ({ carryover: carryover(), revision, workspace: 'worktree', blocked: null, ...over });
const block = (code: ContinueBlock['code'], message = 'It cannot be continued yet.'): ContinueBlock => ({ code, message });

function fakeApi(over: Partial<ContinueApi> = {}) {
  const api = {
    thread: vi.fn(async (id: string) => ({ thread: thread({ id, title: 'Fix the build', harness: 'claude', channel_id: 'c1' }) })),
    continuePreview: vi.fn(async (_id: string, _body: unknown) => preview()),
    continueThread: vi.fn(async (_id: string, _body: unknown) => ({ thread: thread({ id: 'new1', title: 'Fork' }), duplicate: false })),
    closeTerminal: vi.fn(async (_id: string) => ({ open: false, running: false, code: null })),
    ...over,
  };
  return api as typeof api & ContinueApi;
}

/** What `useContinue` does, without React: the reducer, and the preview asked again for the run and attachments on screen. */
function screen(api: ContinueApi, offered = continueTargets(catalog()).offered) {
  let s = initContinue(defaultRun(offered, SOURCE.harness));
  const seen: ContinueAction[] = [];
  const dispatch = (a: ContinueAction) => {
    seen.push(a);
    s = continueReducer(s, a);
  };
  return {
    seen,
    dispatch,
    state: () => s as ContinueState,
    ask: (alive: () => boolean = () => true) => (s.run ? loadPreview(api, SOURCE.id, s.run, s.picked, dispatch, alive) : Promise.resolve()),
    start: () => startContinue(api, SOURCE.id, s, dispatch),
    typed: (text: string) => dispatch({ type: 'text', text }),
  };
}

describe('loadSource', () => {
  it('reads what the screen needs of the thread', async () => {
    const api = fakeApi();
    expect(await loadSource(api, 't1')).toEqual({ status: 'ready', source: SOURCE });
    expect(api.thread).toHaveBeenCalledWith('t1');
  });

  it('says a missing thread is gone and keeps the server words for anything else', async () => {
    const gone = await loadSource(fakeApi({ thread: vi.fn(async () => Promise.reject(refusal(404, 'not found'))) }), 't1');
    expect(gone).toMatchObject({ status: 'failed', error: expect.stringContaining('gone') });
    expect(await loadSource(fakeApi({ thread: vi.fn(async () => Promise.reject(unreachable())) }), 't1')).toEqual({ status: 'failed', error: 'Cannot reach the Omni server. Is it running?' });
  });
});

describe('the harnesses Continue offers', () => {
  it('lists the local harnesses and gives the remote ones a reason', () => {
    const withRemote = [...catalog(), { id: 'cursor-cloud', name: 'Cursor Cloud', available: true, models: [{ id: 'auto' }] } as never];
    const { offered, refused } = continueTargets(withRemote);
    expect(offered.map((h) => h.id)).toEqual(['claude', 'codex']);
    expect(refused).toEqual([
      { id: 'hermes', reason: expect.stringContaining('Hermes') },
      { id: 'cursor-cloud', reason: expect.stringContaining('Cursor Cloud') },
    ]);
  });

  it('opens on the first ready harness other than the source', () => {
    const { offered } = continueTargets(catalog());
    expect(defaultRun(offered, 'claude')).toEqual({ harness: 'codex', model: 'gpt', effort: '' });
  });

  it('has no run, and cannot start, when no local harness is ready', async () => {
    const api = fakeApi();
    const none = continueTargets(catalog().map((h) => ({ ...h, available: false })));
    const ui = screen(api, none.offered);
    expect(ui.state().run).toBeNull();
    await ui.ask();
    ui.typed('go on');
    expect(canStart(ui.state())).toBe(false);
    expect(await ui.start()).toBeNull();
    expect(api.continuePreview).not.toHaveBeenCalled();
    expect(api.continueThread).not.toHaveBeenCalled();
  });

  it('builds the picker from the offered harnesses, with the picked run checked', () => {
    const down = { id: 'gemini', name: 'Gemini', plan: 'Google', available: false, fix: 'gemini login', models: [] } as never;
    const { offered } = continueTargets([...catalog(), down]);
    const model = pickerModel({ harness: 'codex', model: 'gpt', effort: '' }, offered);
    expect(model?.harnesses.map((h) => h.id)).toEqual(['claude', 'codex', 'gemini']);
    expect(model?.harnesses.find((h) => h.id === 'codex')?.models[0]).toMatchObject({ id: 'gpt', selected: true });
    expect(model?.harnesses.find((h) => h.id === 'gemini')).toMatchObject({ available: false, fix: 'gemini login' });
    expect(pickerModel(null, offered)?.harnesses.length).toBe(3);
    expect(pickerModel(null, [])).toBeNull();
  });

  it('turns a tap into a run: another model at its default effort, an effort on the same model', () => {
    const run = { harness: 'claude', model: 'sonnet', effort: 'low' };
    expect(runFor(run, { harness: 'codex', model: 'gpt' })).toEqual({ harness: 'codex', model: 'gpt', effort: '' });
    expect(runFor(run, { effort: 'high' })).toEqual({ harness: 'claude', model: 'sonnet', effort: 'high' });
    expect(runFor(null, { effort: 'high' })).toBeNull();
  });
});

describe('the preview', () => {
  it('asks for the picked run and shows what comes back', async () => {
    const api = fakeApi();
    const ui = screen(api);
    expect(ui.state().preview).toEqual({ kind: 'loading', last: null });
    await ui.ask();
    expect(api.continuePreview).toHaveBeenCalledWith('t1', { harness: 'codex', model: 'gpt', effort: '', attachments: [] });
    expect(shownPreview(ui.state().preview)?.revision).toBe('r1');
  });

  it('drops the answer of an ask a later one replaced', async () => {
    let release: (p: ContinuePreview) => void = () => {};
    const api = fakeApi({ continuePreview: vi.fn(() => new Promise<ContinuePreview>((r) => (release = r))) });
    const ui = screen(api);
    let current = true;
    const slow = ui.ask(() => current);
    current = false;
    release(preview('stale'));
    await slow;
    expect(ui.seen.some((a) => a.type === 'previewed')).toBe(false);
    expect(ui.state().preview.kind).toBe('loading');
  });

  it('drops the answer for a run that is no longer picked', async () => {
    let release: (p: ContinuePreview) => void = () => {};
    const api = fakeApi({ continuePreview: vi.fn(() => new Promise<ContinuePreview>((r) => (release = r))) });
    const ui = screen(api);
    const slow = ui.ask();
    ui.dispatch({ type: 'pick', run: { harness: 'claude', model: 'opus', effort: '' } });
    release(preview('for-codex'));
    await slow;
    expect(ui.state().preview.kind).toBe('loading');
  });

  it('asks again with the ticked attachments', async () => {
    const api = fakeApi();
    const ui = screen(api);
    await ui.ask();
    ui.dispatch({ type: 'attach', id: 'a1' });
    await ui.ask();
    expect(api.continuePreview).toHaveBeenLastCalledWith('t1', expect.objectContaining({ attachments: ['a1'] }));
  });

  it('shows a failed preview with its reason, and asks again on Retry', async () => {
    const api = fakeApi({ continuePreview: vi.fn(async () => Promise.reject(refusal(500, 'The carryover could not be built.'))) });
    const ui = screen(api);
    await ui.ask();
    expect(ui.state().preview).toEqual({ kind: 'failed', error: 'The carryover could not be built.' });
    ui.dispatch({ type: 'recheck' });
    expect(ui.state()).toMatchObject({ asked: 1, preview: { kind: 'loading' } });
  });

  it('says the phone was signed out when the preview gets a 401 that survived the refresh', async () => {
    const api = fakeApi({ continuePreview: vi.fn(async () => Promise.reject(refusal(401, 'unauthorized'))) });
    const ui = screen(api);
    await ui.ask();
    expect(ui.state().preview).toEqual({ kind: 'failed', error: SIGNED_OUT_ERROR });
  });

  it('keeps a block from the preview in the way of Start', async () => {
    const ui = screen(fakeApi({ continuePreview: vi.fn(async () => preview('r1', { blocked: block('running', 'A turn is running.') })) }));
    await ui.ask();
    ui.typed('go');
    expect(blockOf(ui.state())).toEqual(block('running', 'A turn is running.'));
    expect(canStart(ui.state())).toBe(false);
  });
});

describe('starting', () => {
  async function ready(api: ContinueApi) {
    const ui = screen(api);
    await ui.ask();
    ui.typed('  Carry on with the tests  ');
    return ui;
  }

  it('sends the run, the revision and the trimmed message, and returns the new thread to open', async () => {
    const api = fakeApi();
    const ui = await ready(api);
    const started = await ui.start();
    expect(started).toMatchObject({ id: 'new1' });
    expect(api.continueThread).toHaveBeenCalledWith('t1', expect.objectContaining({ harness: 'codex', model: 'gpt', effort: '', text: 'Carry on with the tests', revision: 'r1', attachments: [], request_id: expect.any(String) }));
    expect(ui.state().posting).toBe(true);
  });

  it('sends only the attachments that were ticked', async () => {
    const api = fakeApi();
    const ui = await ready(api);
    ui.dispatch({ type: 'attach', id: 'b' });
    ui.dispatch({ type: 'attach', id: 'a' });
    await ui.ask();
    await ui.start();
    expect(api.continueThread).toHaveBeenCalledWith('t1', expect.objectContaining({ attachments: ['a', 'b'] }));
  });

  it('does nothing without a message', async () => {
    const api = fakeApi();
    const ui = screen(api);
    await ui.ask();
    expect(await ui.start()).toBeNull();
    expect(api.continueThread).not.toHaveBeenCalled();
  });

  it('keeps the request id when the same Start is tried again after the answer was lost', async () => {
    const calls: string[] = [];
    const api = fakeApi({
      continueThread: vi.fn(async (_id: string, body: { request_id: string }) => {
        calls.push(body.request_id);
        if (calls.length === 1) throw unreachable();
        return { thread: thread({ id: 'new1' }), duplicate: true };
      }),
    });
    const ui = await ready(api);
    expect(await ui.start()).toBeNull();
    expect(ui.state().refusal).toEqual({ kind: 'error', error: 'Cannot reach the Omni server. Is it running?' });
    expect(await ui.start()).toMatchObject({ id: 'new1' });
    expect(calls[1]).toBe(calls[0]);
  });

  it('re-previews and says the thread changed when the revision is stale', async () => {
    const fresh = preview('r2');
    const api = fakeApi({ continueThread: vi.fn(async () => Promise.reject(refusal(409, 'The thread changed.', { code: 'changed', preview: fresh }))) });
    const ui = await ready(api);
    expect(await ui.start()).toBeNull();
    expect(shownPreview(ui.state().preview)).toEqual(fresh);
    expect(refusalText(ui.state().refusal)).toBe(CHANGED_NOTE);
    expect(ui.state().posting).toBe(false);
    expect(canStart(ui.state())).toBe(true);
  });

  it('shows the block when the thread is not idle', async () => {
    const busy = block('running', 'A turn is running in this thread.');
    const api = fakeApi({ continueThread: vi.fn(async () => Promise.reject(refusal(409, 'busy', { code: 'busy', block: busy }))) });
    const ui = await ready(api);
    expect(await ui.start()).toBeNull();
    expect(blockOf(ui.state())).toEqual(busy);
    expect(canStart(ui.state())).toBe(false);
  });

  it('forgets the request id when the server says it went with another message', async () => {
    const api = fakeApi({ continueThread: vi.fn(async () => Promise.reject(refusal(409, 'That request id was used for another message.', { code: 'request_reused' }))) });
    const ui = await ready(api);
    expect(await ui.start()).toBeNull();
    expect(ui.state().attempt).toBeNull();
    expect(refusalText(ui.state().refusal)).toBe('That request id was used for another message.');
  });

  it('shows the words of any other refusal', async () => {
    const api = fakeApi({ continueThread: vi.fn(async () => Promise.reject(refusal(500, 'Could not cut the worktree.'))) });
    const ui = await ready(api);
    await ui.start();
    expect(refusalText(ui.state().refusal)).toBe('Could not cut the worktree.');
  });

  it('says the phone was signed out on a 401 that survived the refresh', async () => {
    const api = fakeApi({ continueThread: vi.fn(async () => Promise.reject(refusal(401, 'unauthorized'))) });
    const ui = await ready(api);
    await ui.start();
    expect(refusalText(ui.state().refusal)).toBe(SIGNED_OUT_ERROR);
    expect(startFailure(refusal(401, 'x'))).toEqual({ kind: 'error', error: SIGNED_OUT_ERROR });
  });
});

describe('closing the terminal', () => {
  it('closes the shell and asks for the preview again', async () => {
    const api = fakeApi({ continuePreview: vi.fn(async () => preview('r1', { blocked: block('terminal', 'A shell is open in the Terminal tab.') })) });
    const ui = screen(api);
    await ui.ask();
    expect(closesTerminal(blockOf(ui.state()))).toBe(true);

    (api.continuePreview as unknown as { mockResolvedValue: (p: ContinuePreview) => void }).mockResolvedValue(preview('r2'));
    await closeSourceTerminal(api, 't1', ui.dispatch);
    expect(api.closeTerminal).toHaveBeenCalledWith('t1');
    expect(ui.state().asked).toBe(1);
    await ui.ask();
    expect(blockOf(ui.state())).toBeNull();
  });

  it('shows why when the terminal will not close', async () => {
    const api = fakeApi({ closeTerminal: vi.fn(async () => Promise.reject(refusal(500, 'The shell did not stop.'))) });
    const ui = screen(api);
    await closeSourceTerminal(api, 't1', ui.dispatch);
    expect(refusalText(ui.state().refusal)).toBe('The shell did not stop.');
    expect(ui.state().asked).toBe(0);
  });

  it('offers it for the terminal block only', () => {
    expect(closesTerminal(block('running'))).toBe(false);
    expect(closesTerminal(null)).toBe(false);
  });
});
