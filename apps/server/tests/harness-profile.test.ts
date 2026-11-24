import { describe, expect, it } from 'vitest';
import { SKILL_HARNESSES } from '@omni/shared/agent-skills.ts';
import { antigravityAdapter } from '../harness/antigravity/adapter.ts';
import { claudeAdapter } from '../harness/claude/adapter.ts';
import { codexAdapter } from '../harness/codex/adapter.ts';
import { cursorAdapter } from '../harness/cursor/adapter.ts';
import { cursorCloudAdapter } from '../harness/cursor-cloud/adapter.ts';
import { hermesAdapter, runsApiAdapter } from '../harness/hermes/adapter.ts';
import { profileOf, RUNS_API_PROFILE } from '../harness/profile.ts';
import { providerWhere } from '../harness/registry.ts';
import { CAPABILITIES, HARNESS_IDS, RUNS_API_CAPABILITIES } from '../harness/types.ts';

// The adapter is the one answer to what its harness does (ADR 0017): runner, sync, handoff and skills read its profile.
const ADAPTERS = [claudeAdapter, codexAdapter, cursorAdapter, cursorCloudAdapter, hermesAdapter, antigravityAdapter];

describe('harness profiles', () => {
  it('each built-in adapter carries the profile its id looks up', () => {
    expect(ADAPTERS.map((a) => a.id).sort()).toEqual([...HARNESS_IDS].sort());
    for (const a of ADAPTERS) expect(a.profile).toBe(profileOf(a.id));
  });

  it('a custom harness, registered here or not, runs with the Runs API profile', () => {
    expect(profileOf('custom:vps')).toBe(RUNS_API_PROFILE);
    expect(runsApiAdapter('custom:vps', RUNS_API_CAPABILITIES).profile).toBe(RUNS_API_PROFILE);
    expect(providerWhere('custom:gone')).toBe("on custom:gone's own server");
  });

  it('gives skills and session files only to the harnesses that run on this machine', () => {
    for (const id of HARNESS_IDS) {
      const p = profileOf(id);
      if (CAPABILITIES[id].remote) {
        expect(p.skills, id).toBeNull();
        expect(p.sessionFiles, id).toBeNull();
        expect(p.where, id).toBeTruthy();
      }
    }
    // The clients' list (packages/shared) is the profiles' own.
    expect(HARNESS_IDS.filter((id) => profileOf(id).skills)).toEqual([...SKILL_HARNESSES]);
  });

  it('says why for every harness a thread cannot switch to or from', () => {
    for (const id of HARNESS_IDS) if (!CAPABILITIES[id].switchable) expect(profileOf(id).switchRefusal, id).toBeTruthy();
    expect(RUNS_API_PROFILE.switchRefusal).toBeTruthy();
  });
});
