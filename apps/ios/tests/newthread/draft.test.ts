import { OmniHttpError, type ChannelWithRunning, type CrewRole } from '@omni/client-core';
import { describe, expect, it, vi } from 'vitest';

import {
  applyPick,
  attemptFor,
  createFailure,
  createRequest,
  draftChipLabel,
  draftSheetModel,
  newThreadId,
  roleOf,
  runOnBody,
  runOnList,
  shownDraftRun,
  startThread,
  targetsOf,
  uuidV4,
  type DraftInputs,
} from '../../src/newthread/draft';
import { device } from '../machine/fixtures';
import { catalog, thread } from '../thread/fixtures';

const harnesses = catalog();

const channel = (over: Partial<ChannelWithRunning> = {}) =>
  ({ id: 'acme', name: 'Acme', kind: 'client', archived: 0, default_harness: null, default_model: null, default_effort: null, running: 0, ...over }) as ChannelWithRunning;
const role = (over: Partial<CrewRole> = {}) => ({ id: 'conductor', name: 'Conductor', description: '', mcp: [], charter: '', ...over }) as CrewRole;

const inputs = (over: Partial<DraftInputs> = {}): DraftInputs => ({
  target: 'conductor',
  text: 'Fix the build',
  picked: null,
  channels: [channel({ id: 'conductor', name: 'Conductor', kind: 'system' }), channel()],
  crew: [role()],
  harnesses,
  ...over,
});

const http = (status: number, message = 'nope') => new OmniHttpError({ kind: 'http', status, message, body: null, retryAfter: null });

describe('where a thread can start', () => {
  it('lists the Conductor first, then live channels, and leaves out archived ones', () => {
    const channels = [channel({ id: 'conductor', name: 'Conductor' }), channel({ id: 'a', name: 'Alpha' }), channel({ id: 'b', name: 'Beta', archived: 1 })];
    expect(targetsOf(channels)).toEqual([
      { id: 'conductor', name: 'Conductor' },
      { id: 'a', name: 'Alpha' },
    ]);
  });

  it('still offers the Conductor before the channels have loaded', () => {
    expect(targetsOf(null)).toEqual([{ id: 'conductor', name: 'Conductor' }]);
  });

  it("gives the Conductor its crew role and any other channel none", () => {
    expect(roleOf('conductor', [role()])?.id).toBe('conductor');
    expect(roleOf('conductor', [])).toBeUndefined();
    expect(roleOf('acme', [role()])).toBeUndefined();
  });
});

describe('the request', () => {
  it('sends nothing for an empty message', () => {
    expect(createRequest(inputs({ text: '  \n ' }))).toBeNull();
  });

  it('starts a channel thread with only the channel and the trimmed message when nothing is picked', () => {
    expect(createRequest(inputs({ target: 'acme', text: '  Fix the build \n' }))).toEqual({ channel: 'acme', prompt: 'Fix the build', role: undefined });
  });

  it('starts a Conductor thread as the Conductor role', () => {
    expect(createRequest(inputs())).toMatchObject({ channel: 'conductor', prompt: 'Fix the build', role: 'conductor' });
  });

  it('leaves the role out when the server has no such role', () => {
    expect(createRequest(inputs({ crew: [] }))?.role).toBeUndefined();
  });

  it('sends a deliberate pick, and Auto as the model alone', () => {
    const picked = { choice: { harness: 'claude', model: 'opus' }, effort: 'high' };
    expect(createRequest(inputs({ target: 'acme', picked }))).toMatchObject({ harness: 'claude', model: 'opus', effort: 'high' });
    const auto = { choice: { harness: 'auto', model: 'auto' }, effort: '' };
    const body = createRequest(inputs({ target: 'acme', picked: auto }));
    expect(body).toMatchObject({ model: 'auto' });
    expect(body).not.toHaveProperty('harness');
  });
});

describe('the run the sheet shows', () => {
  it("follows the channel's defaults until a pick", () => {
    const tuned = inputs({ target: 'acme', channels: [channel({ default_harness: 'claude', default_model: 'opus', default_effort: 'low' })] });
    expect(shownDraftRun(tuned)).toEqual({ choice: { harness: 'claude', model: 'opus' }, effort: 'low' });
  });

  it('is Auto when nothing sets a run', () => {
    expect(shownDraftRun(inputs({ target: 'acme' }))?.choice).toEqual({ harness: 'auto', model: 'auto' });
  });

  it('waits for the catalog', () => {
    expect(shownDraftRun(inputs({ harnesses: null }))).toBeNull();
  });

  it('names the run as the thread chip does, and Auto as Auto', () => {
    expect(draftChipLabel({ choice: { harness: 'claude', model: 'opus' }, effort: 'low' }, harnesses)).toBe('Opus 5.5 · low');
    expect(draftChipLabel({ choice: { harness: 'auto', model: 'auto' }, effort: '' }, harnesses)).toBe('Auto');
  });
});

describe('a tap in the model sheet', () => {
  const sonnet = { choice: { harness: 'claude', model: 'sonnet' }, effort: 'high' };

  it('keeps the effort when the same model is tapped', () => {
    expect(applyPick(sonnet, { harness: 'claude', model: 'sonnet' })).toBe(sonnet);
  });

  it("starts another model at its default effort, whatever effort was shown", () => {
    expect(applyPick(sonnet, { harness: 'claude', model: 'opus' })).toEqual({ choice: { harness: 'claude', model: 'opus' }, effort: '' });
    expect(applyPick(sonnet, { harness: 'codex', model: 'gpt' })).toEqual({ choice: { harness: 'codex', model: 'gpt' }, effort: '' });
  });

  it('changes the effort and keeps the model', () => {
    expect(applyPick(sonnet, { effort: 'low' })).toEqual({ choice: sonnet.choice, effort: 'low' });
  });

  it('goes to Auto, and leaves Auto for a model', () => {
    const auto = applyPick(sonnet, 'auto');
    expect(auto).toEqual({ choice: { harness: 'auto', model: 'auto' }, effort: '' });
    expect(applyPick(auto, { harness: 'claude', model: 'sonnet' })).toEqual({ choice: { harness: 'claude', model: 'sonnet' }, effort: '' });
  });
});

describe('the model sheet rows', () => {
  it('checks the shown model and lists its effort levels', () => {
    const rows = draftSheetModel({ choice: { harness: 'claude', model: 'opus' }, effort: 'low' }, harnesses);
    expect(rows.auto).toBe(false);
    expect(rows.harnesses.flatMap((h) => h.models.filter((m) => m.selected).map((m) => `${h.id}/${m.id}`))).toEqual(['claude/opus']);
    expect(rows.efforts.find((e) => e.selected)?.value).toBe('low');
  });

  it('checks no model and shows no effort while Auto is picked', () => {
    const rows = draftSheetModel({ choice: { harness: 'auto', model: 'auto' }, effort: '' }, harnesses);
    expect(rows.auto).toBe(true);
    expect(rows.efforts).toEqual([]);
    expect(rows.harnesses.flatMap((h) => h.models.filter((m) => m.selected))).toEqual([]);
  });
});

describe('the id a request keeps', () => {
  const request = { channel: 'acme', prompt: 'Fix the build' };
  let n = 0;
  const newId = () => `id-${++n}`;

  it('keeps the id for the same request, so a retry cannot start a second thread', () => {
    const first = attemptFor(null, request, newId);
    expect(attemptFor(first, { ...request }, newId)).toBe(first);
  });

  it('takes a new id when the text, the channel or the run changes', () => {
    const first = attemptFor(null, request, newId);
    const ids = [{ ...request, prompt: 'Fix the tests' }, { ...request, channel: 'beta' }, { ...request, model: 'opus' }].map((r) => attemptFor(first, r, newId).id);
    expect(new Set([first.id, ...ids]).size).toBe(4);
  });

  it('makes version 4 uuids, which the server takes as thread ids', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(newThreadId()).toMatch(uuid);
    expect(uuidV4(new Uint8Array(16))).toMatch(uuid);
    expect(uuidV4(new Uint8Array(16).fill(255))).toMatch(uuid);
  });
});

describe('when the start fails', () => {
  it('says offline in words for this sheet, and that a second try is safe', () => {
    const f = createFailure(new OmniHttpError({ kind: 'unreachable', detail: 'x' }));
    expect(f.kind).toBe('offline');
    expect(f.message).toContain('Cannot reach the server');
    expect(f.message).toContain('will not start a second thread');
  });

  it("passes on the server's refusal, which a second try would not change", () => {
    expect(createFailure(http(404, 'unknown channel "gone"'))).toEqual({ kind: 'refused', message: 'unknown channel "gone"' });
  });

  it('says a server error may have started the thread and that trying again is safe', () => {
    const f = createFailure(http(500, 'Internal Server Error'));
    expect(f.kind).toBe('server');
    expect(f.message).toBe('Internal Server Error A second try will not start a second thread.');
  });

  it('says the phone was signed out', () => {
    expect(createFailure(http(401, 'Unauthorized'))).toMatchObject({ kind: 'signed-out', message: expect.stringContaining('no longer accepts this phone') });
  });

  it('hands back the thread the server made', async () => {
    const made = thread({ id: 'new' });
    const create = vi.fn(async () => made);
    expect(await startThread(create, { id: 'u', channel: 'acme', prompt: 'hi' })).toEqual({ kind: 'created', thread: made });
    expect(create).toHaveBeenCalledWith({ id: 'u', channel: 'acme', prompt: 'hi' });
  });

  it('never rejects, so the sheet can show what happened', async () => {
    const out = await startThread(async () => Promise.reject(http(404, 'unknown channel "gone"')), { id: 'u', channel: 'gone', prompt: 'hi' });
    expect(out).toEqual({ kind: 'failed', failure: { kind: 'refused', message: 'unknown channel "gone"' } });
  });

  it('retries a lost reply under the same id', async () => {
    const seen: string[] = [];
    let attempt = attemptFor(null, { channel: 'acme', prompt: 'hi' }, newThreadId);
    const create = vi
      .fn()
      .mockImplementationOnce(async (b) => {
        seen.push(b.id);
        throw new OmniHttpError({ kind: 'unreachable', detail: 'dropped' });
      })
      .mockImplementationOnce(async (b) => {
        seen.push(b.id);
        return thread({ id: b.id });
      });
    expect((await startThread(create, { ...{ channel: 'acme', prompt: 'hi' }, id: attempt.id })).kind).toBe('failed');
    attempt = attemptFor(attempt, { channel: 'acme', prompt: 'hi' }, newThreadId);
    expect((await startThread(create, { channel: 'acme', prompt: 'hi', id: attempt.id })).kind).toBe('created');
    expect(seen[0]).toBe(seen[1]);
  });
});

describe('where a new thread runs', () => {
  const devices = [device(), device({ id: 'm3', name: 'Mini', reachability: 'offline' })];

  it('sends the machine that was picked, with the request', () => {
    expect(createRequest(inputs({ runOn: { pick: 'm2', devices } }))).toMatchObject({ channel: 'conductor', device: 'm2' });
    expect(createRequest(inputs({ runOn: { pick: 'here', devices } }))).toMatchObject({ device: 'here' });
  });

  it('leaves it to the server default until one is picked', () => {
    expect(createRequest(inputs({ runOn: { pick: null, devices } }))).not.toHaveProperty('device');
  });

  it('sends nothing with one machine, or for a machine that is no longer listed', () => {
    expect(runOnBody({ pick: 'm2', devices: null })).toEqual({});
    expect(runOnBody({ pick: 'm2', devices: [] })).toEqual({});
    expect(runOnBody({ pick: 'gone', devices })).toEqual({});
  });

  it('sends a different request, so a new thread id, when the machine changes', () => {
    const a = createRequest(inputs({ runOn: { pick: 'm2', devices } }))!;
    const b = createRequest(inputs({ runOn: { pick: 'here', devices } }))!;
    expect(attemptFor(null, a, () => 'x').key).not.toBe(attemptFor(null, b, () => 'x').key);
  });

  it('lists this machine first under its name, and greys out an offline one', () => {
    const rows = runOnList(devices, 'Laptop');
    expect(rows.map((r) => [r.value, r.label, r.disabled])).toEqual([
      ['here', 'Laptop', false],
      ['m2', 'Studio', false],
      ['m3', 'Mini', true],
    ]);
    expect(rows[2]?.sub).toBe('Asleep or offline');
  });
});

describe('a new thread with files', () => {
  const request = { channel: 'acme', prompt: 'Look' } as never;
  const photo = { id: 'p1', uri: 'file:///c/a.jpg', name: 'a.jpg', type: 'image/jpeg', size: 10, image: true, source: 'library' } as const;
  const doc = { id: 'd1', uri: 'file:///c/b.pdf', name: 'b.pdf', type: 'application/pdf', size: 20, image: false, source: 'files' } as const;

  it('keeps the thread id for the same words and files, and takes a new one for other files', () => {
    const ids = ['one', 'two', 'three'];
    const newId = () => ids.shift()!;
    const first = attemptFor(null, request, newId, [photo]);
    expect(attemptFor(first, { ...(request as object) } as never, newId, [photo])).toBe(first);
    expect(attemptFor(first, request, newId, [photo, doc]).id).toBe('two');
    expect(attemptFor(first, request, newId).id).toBe('three');
  });

  it('says a cancelled upload was cancelled, and that nothing was made', () => {
    expect(createFailure(new OmniHttpError({ kind: 'cancelled' }))).toMatchObject({ kind: 'cancelled', message: expect.stringMatching(/cancel/i) });
  });
});
