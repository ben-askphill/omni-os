import { describe, expect, it } from 'vitest';
import type { DesktopUpdateView } from '@omni/shared/desktop-bridge.ts';
import type { DesktopUpdateCommand, DesktopUpdateReport } from '@omni/shared/update-fleet.ts';
import { createUpdateReporter } from '../src/update-report.ts';

/** A server that hands out one command until a report names its id in `done`, as POST /api/update/desktop does. */
function setup(options: { command?: DesktopUpdateCommand; canReport?: boolean; carryOut?: (command: DesktopUpdateCommand) => boolean } = {}) {
  const sent: DesktopUpdateReport[] = [];
  const carried: string[] = [];
  const failures: unknown[] = [];
  let view: DesktopUpdateView = { state: 'idle', checkedAt: null };
  let command = options.command ?? null;
  let down = false;
  let stubborn = false;
  let gate: Promise<void> = Promise.resolve();
  const state = {
    canReport: options.canReport ?? true,
    carryOut: options.carryOut ?? (() => true),
  };
  const report = createUpdateReporter({
    canReport: () => state.canReport,
    current: () => ({ version: '0.1.2', view }),
    send: async (body) => {
      sent.push(body);
      await gate;
      // A turn of the event loop, so a report that never stops asking fails the test by its timeout, not by hanging it.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (down) throw new Error('POST /api/update/desktop: 404');
      if (command && body.done === command.id && !stubborn) command = null;
      return { command };
    },
    carryOut: (c) => {
      const taken = state.carryOut(c);
      if (taken) carried.push(c.id);
      return taken;
    },
    onFirstFailure: (err) => failures.push(err),
  });
  return {
    report,
    sent,
    carried,
    failures,
    state,
    setView: (next: DesktopUpdateView) => (view = next),
    setCommand: (next: DesktopUpdateCommand | null) => (command = next),
    setDown: (next: boolean) => (down = next),
    setStubborn: (next: boolean) => (stubborn = next),
    hold: () => {
      let release!: () => void;
      gate = new Promise((resolve) => (release = resolve));
      return release;
    },
  };
}

const install: DesktopUpdateCommand = { id: 'c1', action: 'install' };

describe('reporting the updater to the server', () => {
  it('sends the version and the view, and nothing done yet', async () => {
    const t = setup();
    await t.report();
    expect(t.sent).toEqual([{ version: '0.1.2', view: { state: 'idle', checkedAt: null }, done: null }]);
    expect(t.carried).toEqual([]);
  });

  it('sends nothing while there is nothing to report to', async () => {
    const t = setup({ canReport: false });
    await t.report();
    expect(t.sent).toEqual([]);
  });

  it('carries out a command once, though the server keeps handing it out', async () => {
    const t = setup({ command: install });
    t.setStubborn(true);
    await t.report();
    await t.report();
    await t.report();
    expect(t.carried).toEqual(['c1']);
    expect(t.sent.at(-1)?.done).toBe('c1');
  });

  it('names a carried out command in the very next report, so the server stops handing it out', async () => {
    const t = setup({ command: install });
    await t.report();
    expect(t.carried).toEqual(['c1']);
    expect(t.sent.map((body) => body.done)).toEqual([null, 'c1']);
    await t.report();
    expect(t.carried).toEqual(['c1']);
  });

  it('carries out a later command with its own id', async () => {
    const t = setup({ command: { id: 'c1', action: 'check' } });
    await t.report();
    t.setCommand({ id: 'c2', action: 'download' });
    await t.report();
    expect(t.carried).toEqual(['c1', 'c2']);
    expect(t.sent.at(-1)?.done).toBe('c2');
  });

  it('keeps a command the view does not let it act on yet, and carries it out when the view allows', async () => {
    let allowed = false;
    const t = setup({ command: { id: 'c1', action: 'download' }, carryOut: () => allowed });
    await t.report();
    await t.report();
    expect(t.carried).toEqual([]);
    expect(t.sent.every((body) => body.done === null)).toBe(true);
    allowed = true;
    await t.report();
    expect(t.carried).toEqual(['c1']);
  });

  it('sends one report at a time, and one more after a burst of view changes', async () => {
    const t = setup();
    const release = t.hold();
    const first = t.report();
    t.setView({ state: 'downloading', version: '0.2.0', percent: 1 });
    void t.report();
    t.setView({ state: 'downloading', version: '0.2.0', percent: 2 });
    void t.report();
    t.setView({ state: 'downloading', version: '0.2.0', percent: 3 });
    void t.report();
    expect(t.sent).toHaveLength(1);
    release();
    await first;
    expect(t.sent.map((body) => body.view)).toEqual([
      { state: 'idle', checkedAt: null },
      { state: 'downloading', version: '0.2.0', percent: 3 },
    ]);
  });

  it('is quiet when the server does not answer: one failure noted, and reporting resumes when it does', async () => {
    const t = setup({ command: install });
    t.setDown(true);
    await t.report();
    await t.report();
    await t.report();
    expect(t.failures).toHaveLength(1);
    expect(t.carried).toEqual([]);
    t.setDown(false);
    await t.report();
    expect(t.carried).toEqual(['c1']);
    t.setDown(true);
    await t.report();
    expect(t.failures).toHaveLength(1);
  });

  it('ignores an answer it does not know, as an older server gives', async () => {
    const sent: DesktopUpdateReport[] = [];
    const carried: string[] = [];
    const report = createUpdateReporter({
      canReport: () => true,
      current: () => ({ version: '0.1.2', view: { state: 'idle', checkedAt: null } }),
      send: async (body) => {
        sent.push(body);
        return { ok: true };
      },
      carryOut: (c) => !!carried.push(c.id),
      onFirstFailure: () => {},
    });
    await report();
    expect(sent).toHaveLength(1);
    expect(carried).toEqual([]);
  });
});
