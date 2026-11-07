import type { SetupState } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import { configDirty, configPatch, configProblem, configRows, configValues } from '../../src/settings/config-model';

const state = (over: Partial<SetupState['config']> = {}, env: Record<string, string> = {}): SetupState => ({
  onboarded: true,
  path: '~/omni/data/omni.config.json',
  config: {
    version: 1,
    user: { name: 'Ben', pronouns: 'they/them', timezone: '', email: '' },
    workspace: { root: '', reposDir: '~/code', githubOwner: 'askphill' },
    integrations: { hermesUrl: '', centralBrainDir: '', tailscaleLogin: '', mcpPublicUrl: '', clerkPublishableKey: '', clerkClientId: '' },
    runOn: { device: '' },
    automations: {},
    worktrees: { retention: { enabled: false, idleDays: 14 } },
    ...over,
  },
  resolved: { timezone: 'Europe/Amsterdam', workspaceRoot: '~/Omni', reposDir: '~/code', centralBrainDir: '~/central-brain', hermesUrl: '' },
  fallbacks: { timezone: 'Europe/Amsterdam', workspaceRoot: '~/Omni', reposDir: '~/repos', home: '~' },
  omniRepo: null,
  env,
});

describe('config fields on the phone', () => {
  it('edits text fields and shows folders as their value on the server', () => {
    const rows = configRows('workspace', state());
    expect(rows.map((r) => [r.label, r.editable, r.shown])).toEqual([
      ['Workspace folder', false, '~/Omni'],
      ['Repos folder', false, '~/code'],
      ['GitHub owner', true, 'askphill'],
    ]);
  });

  it('says where a value comes from', () => {
    const rows = configRows('general', state({}, { 'user.timezone': 'OMNI_TZ' }));
    expect(Object.fromEntries(rows.map((r) => [r.label, r.origin]))).toMatchObject({ Name: 'Set on this machine', Timezone: 'Set by OMNI_TZ', Email: 'Built-in default' });
  });

  it('saves only editable fields, trimmed, with an emptied pronoun back to its default', () => {
    const s = state();
    const rows = configRows('general', s);
    const values = { ...configValues(rows, s), 'user.name': ' Ben R ', 'user.pronouns': '' };
    expect(configDirty(rows, values, s)).toBe(true);
    expect(configPatch(rows, values)).toEqual({ user: { name: 'Ben R', pronouns: 'they/them', timezone: '', email: '' } });
    expect(configDirty(rows, configValues(rows, s), s)).toBe(false);
  });

  it('refuses what the server would, before sending', () => {
    const s = state();
    const rows = configRows('general', s);
    expect(configProblem(rows, { ...configValues(rows, s), 'user.name': '' })).toBe('Enter a name.');
    expect(configProblem(rows, { ...configValues(rows, s), 'user.email': 'nope' })).toMatch(/valid email/);
  });

  it('shows the access fields, which only the file sets, without a form', () => {
    expect(configRows('access', state()).every((r) => !r.editable)).toBe(true);
  });
});
