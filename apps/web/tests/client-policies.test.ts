import { readFileSync } from 'node:fs';
import { fixture } from '@omni/test-fixtures';
import { describe, expect, it } from 'vitest';
import { carriedText, carryoverSize, continueRefusal, continueSourceRefusal, entryText, type CarriedStats, type CarryoverEntry } from '@omni/shared/continue.ts';
import { handoffText, takeoverConfirm, takeoverNote, type Device, type HandoffView, type Takeover } from '@omni/shared/handoff.ts';
import type { HarnessWithRunning } from '../src/api.ts';
import { continueTargets, defaultRun, slashHint } from '../src/continue.ts';
import { deviceRows, handoffBanner } from '../src/handoff.ts';
import { HERE, runOnDefault, runOnPick, runOnRequest, runOnRows, settingPick } from '../src/run-on.ts';

// The client policies the Web UI and the Mac app both implement, held to one corpus each in
// packages/test-fixtures/policies/. apps/mac/OmniKit/Tests/OmniKitTests/ClientPolicyTests.swift reads the same files,
// so the two ports cannot drift. A case that fails here and not there (or the reverse) is a real difference.

const corpus = (name: string) => JSON.parse(readFileSync(fixture('policies', `${name}.json`), 'utf8'));

describe('Continue eligibility (policies/continue.json)', () => {
  const c = corpus('continue');

  it.each(c.refusals as { harness: string; target: string | null; source: string | null }[])('$harness', (r) => {
    expect(continueRefusal(r.harness)).toBe(r.target);
    expect(continueSourceRefusal(r.harness)).toBe(r.source);
  });

  it.each(c.targets as { case: string; source: string; unavailable: string[]; offered: string[]; refused: string[]; initial: { harness: string; model: string } | null }[])(
    '$case',
    (t) => {
      const catalog = (c.catalog as HarnessWithRunning[]).map((h) => ({ ...h, available: h.available && !t.unavailable.includes(h.id) }));
      const targets = continueTargets(catalog);
      expect(targets.offered.map((h) => h.id)).toEqual(t.offered);
      expect(targets.refused.map((h) => h.id)).toEqual(t.refused);
      const run = defaultRun(targets.offered, t.source);
      expect(run && { harness: run.harness, model: run.model }).toEqual(t.initial);
    },
  );

  it('says a slash command runs first', () => {
    for (const s of c.slashHints as { text: string; hint: string | null }[]) expect(slashHint(s.text), JSON.stringify(s.text)).toBe(s.hint);
  });

  it('writes the size, the carried line and each entry as a row shows it', () => {
    for (const s of c.sizes as { chars: number; budget: number; text: string }[]) expect(carryoverSize(s)).toBe(s.text);
    for (const s of c.carried as { stats: CarriedStats; text: string }[]) expect(carriedText(s.stats)).toBe(s.text);
    for (const e of c.entries as (Pick<CarryoverEntry, 'who' | 'text'> & { shown: string })[]) expect(entryText(e)).toBe(e.shown);
  });
});

describe('handoff display (policies/handoff.json)', () => {
  const h = corpus('handoff');

  it.each(h.views as { case: string; view: HandoffView; status: string; text: string; banner: { size: string; tone: string; cancel?: boolean } | null }[])('$case', (v) => {
    expect(handoffText(v.view)).toBe(v.text);
    const banner = handoffBanner(v.view, v.status);
    expect(banner && { size: banner.size, tone: banner.tone, ...('cancel' in banner ? { cancel: banner.cancel } : {}) }).toEqual(v.banner);
    if (banner) expect(banner.text).toBe(v.text);
  });

  it('writes the Take over note and confirm', () => {
    for (const t of h.takeovers as { takeover: Takeover; note: string; confirm: { title: string; body: string } }[]) {
      expect(takeoverNote(t.takeover)).toBe(t.note);
      expect(takeoverConfirm(t.takeover)).toEqual(t.confirm);
    }
  });

  it.each(h.devices as { case: string; devices: Device[]; rows: { id: string; pickable: boolean; label: string }[] }[])('$case', (d) => {
    expect(deviceRows(d.devices).map((r) => ({ id: r.id, pickable: r.pickable, label: r.label }))).toEqual(d.rows);
  });
});

describe('run-location defaults (policies/run-on.json)', () => {
  const r = corpus('run-on');
  const devices = (listed: string[]) => (r.devices as Device[]).filter((d) => listed.includes(d.id));
  /** The corpus writes this machine as "", the Web UI as HERE. */
  const pick = (p: string) => (p === HERE ? '' : p);
  const here = (p: string) => (p === '' ? HERE : p);

  it.each(r.defaults as { case: string; listed: string[]; saved: string; pick: string }[])('starts on: $case', (c) => {
    expect(pick(runOnDefault(c.saved, devices(c.listed)))).toBe(c.pick);
    expect(pick(settingPick(c.saved, devices(c.listed))), "Settings shows what the server runs on").toBe(c.pick);
  });

  it.each(r.holds as { case: string; listed: string[]; picked: string | null; saved: string; pick: string }[])('holds: $case', (c) => {
    expect(pick(runOnPick(c.picked === null ? null : here(c.picked), c.saved, devices(c.listed)))).toBe(c.pick);
  });

  it.each(r.sent as { case: string; listed: string[]; pick: string; device: string | null }[])('sends: $case', (c) => {
    expect((runOnRequest(here(c.pick), devices(c.listed)) as { device?: string }).device ?? null).toBe(c.device);
  });

  it('names the pick', () => {
    for (const c of r.labels as { listed: string[]; pick: string; label: string }[]) {
      expect(runOnRows(devices(c.listed)).find((row) => row.value === here(c.pick))?.label).toBe(c.label);
    }
  });
});
