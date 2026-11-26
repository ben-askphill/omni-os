import { describe, expect, it } from 'vitest';
import { compactAutomations, compactHarnesses, compactSettings, compactThreads, redundantLabel, shortTime } from '../compact-lookups.ts';

describe('redundantLabel', () => {
  it('detects labels whose tokens appear in order in id and keeps labels that add info', () => {
    expect(redundantLabel('claude-opus-5-5', 'Opus 5.5')).toBe(true);
    expect(redundantLabel('gpt-6-1', 'GPT-6.1')).toBe(true);
    expect(redundantLabel('claude-code', 'Claude Code')).toBe(true);
    expect(redundantLabel('gpt-6-1', 'GPT-6.1 Sol')).toBe(false);
    expect(redundantLabel('claude-sonnet-4-5', 'Sonnet 5.4')).toBe(false);
    expect(redundantLabel('default', 'Cursor default')).toBe(false);
  });
});

describe('shortTime', () => {
  it('trims seconds and milliseconds from UTC ISO and SQLite timestamps', () => {
    expect(shortTime('2026-11-26T08:00:00.000Z')).toBe('2026-11-26T08:00Z');
    expect(shortTime('2026-11-26T08:15:42Z')).toBe('2026-11-26T08:15Z');
    expect(shortTime('2026-11-26 08:15:42')).toBe('2026-11-26 08:15');
    expect(shortTime('2026-11-16')).toBe('2026-11-16');
    expect(shortTime(null)).toBeNull();
  });
});

describe('compactHarnesses', () => {
  it('hoists shared efforts/default_effort, deduplicates repeated model notes, and omits default capabilities', () => {
    const out = compactHarnesses([
      {
        id: 'claude-code',
        name: 'Claude Code',
        plan: 'Max',
        available: true,
        cap: 12,
        running: 0,
        capabilities: { steer: true, interrupt: true, remote: false, toolLimits: true },
        models: [
          { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'high', default: true, hidden: false, note: null },
          { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'high', default: false, hidden: false, note: null },
          { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: [], defaultEffort: '', default: false, hidden: false, note: null },
        ],
      },
      {
        id: 'antigravity',
        name: 'Antigravity',
        plan: 'Google AI',
        available: true,
        cap: 4,
        running: 2,
        capabilities: { steer: false, interrupt: true, remote: false, toolLimits: false },
        models: [
          { id: 'gemini-4-neon', label: 'Gemini 4 Neon', efforts: ['low', 'high'], defaultEffort: 'high', default: true, note: "agy's current model. Bills your Google AI plan." },
          { id: 'gemini-4-flash', label: 'Gemini 4 Flash', efforts: ['low', 'high'], defaultEffort: 'high', note: "agy's current model. Bills your Google AI plan." },
          { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', efforts: [], defaultEffort: '', hidden: true, note: 'Bills your Google AI plan, not your Claude or ChatGPT plan.' },
          { id: 'gpt-6-1', label: 'GPT-6.1 Sol', efforts: [], defaultEffort: '', hidden: true, note: 'Bills your Google AI plan, not your Claude or ChatGPT plan.' },
        ],
      },
      {
        id: 'cursor-cloud',
        name: 'Cursor Cloud',
        plan: 'Cursor',
        available: true,
        cap: 12,
        running: 0,
        capabilities: { steer: false, interrupt: true, remote: true, toolLimits: false },
        models: [
          { id: 'default', label: 'Cursor default', efforts: [], defaultEffort: '', default: true, note: "Runs on Cursor's Linux cloud. Bills your Cursor plan." },
          { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: [], defaultEffort: '', note: "Runs on Cursor's Linux cloud. Bills your Cursor plan." },
        ],
      },
    ]);

    const [claude, agy, cloud] = out as any[];
    expect(claude).not.toHaveProperty('name');
    expect(claude).not.toHaveProperty('available');
    expect(claude).not.toHaveProperty('running');
    expect(claude).not.toHaveProperty('capabilities');
    expect(claude.efforts).toEqual(['low', 'medium', 'high']);
    expect(claude.default_effort).toBe('high');
    expect(claude.models).toEqual([
      { id: 'claude-opus-5-5', default: true },
      { id: 'claude-sonnet-5-5' },
      { id: 'claude-haiku-4-5', efforts: [] },
    ]);

    expect(agy.running).toBe(2);
    expect(agy.capabilities).toEqual({ steer: false, tool_limits: false });
    expect(agy.notes).toEqual({
      '1': "agy's current model. Bills your Google AI plan.",
      '2': 'Bills your Google AI plan, not your Claude or ChatGPT plan.',
    });
    expect(agy.models.find((m: any) => m.id === 'gpt-6-1')).toEqual({
      id: 'gpt-6-1',
      label: 'GPT-6.1 Sol',
      efforts: [],
      hidden: true,
      note: '2',
    });

    expect(cloud.note).toBe("Runs on Cursor's Linux cloud. Bills your Cursor plan.");
    expect(cloud.models).toEqual([
      { id: 'default', label: 'Cursor default', default: true },
      { id: 'claude-sonnet-5-5' },
    ]);
  });
});

describe('compactThreads', () => {
  it('omits status: done and echoed filter fields while keeping active/failed states and non-defaults', () => {
    const rows = [
      { id: 't1', title: 'Running', channel_id: 'omni-os', role: 'builder', status: 'running', delegating: true, task_id: 'T-1', updated_at: '2026-11-26T08:00:00.000Z', members: [{ name: 'Lead' }, { name: 'Builder' }] },
      { id: 't2', title: 'Done', channel_id: 'omni-os', role: null, status: 'done', delegating: false, task_id: null, updated_at: '2026-11-26T07:55:00.000Z' },
    ];
    expect(compactThreads(rows)).toEqual([
      { id: 't1', title: 'Running', channel: 'omni-os', role: 'builder', status: 'running', delegating: true, task_id: 'T-1', updated_at: '2026-11-26T08:00Z', members: ['Lead', 'Builder'] },
      { id: 't2', title: 'Done', channel: 'omni-os', updated_at: '2026-11-26T07:55Z' },
    ]);
    expect(compactThreads(rows, { channel: 'omni-os', status: 'running' })[0]).not.toHaveProperty('channel');
    expect(compactThreads(rows, { channel: 'omni-os', status: 'running' })[0]).not.toHaveProperty('status');
  });
});

describe('compactAutomations', () => {
  it('omits enabled: true, default runs_on/source, default run trigger/status, and caps prompts at 120 chars', () => {
    const out = compactAutomations([
      {
        id: 'daily-brief',
        name: 'Daily brief',
        enabled: true,
        cron: '0 8 * * 1-5',
        timezone: 'Europe/Amsterdam',
        next: '2026-11-27T07:00:00.000Z',
        channel: 'inbox',
        runs_on: { owner: 'mac-a', isThisMac: true },
        source: 'own',
        prompt: 'Check   status.\n' + 'x'.repeat(200),
        runs: [
          { thread_id: 't1', trigger: 'cron', created_at: '2026-11-26T07:00:00.000Z', status: 'done' },
          { thread_id: 't2', trigger: 'manual', created_at: '2026-11-25T07:00:00.000Z', status: 'failed' },
        ],
      },
      {
        id: 'remote-auto',
        name: 'Runs Elsewhere',
        enabled: false,
        on: { event: 'pr_checks_failed' },
        channel: 'omni-os',
        runs_on: { owner: 'mac-b', isThisMac: false },
        source: 'edited',
        prompt: 'Fix checks',
        runs: [],
      },
    ]) as any[];

    expect(out[0]).not.toHaveProperty('name');
    expect(out[0]).not.toHaveProperty('enabled');
    expect(out[0]).not.toHaveProperty('runs_on');
    expect(out[0]).not.toHaveProperty('source');
    expect(out[0].next).toBe('2026-11-27T07:00Z');
    expect(out[0].prompt).toHaveLength(121);
    expect(out[0].last_runs).toEqual([
      { thread_id: 't1', at: '2026-11-26T07:00Z' },
      { thread_id: 't2', trigger: 'manual', at: '2026-11-25T07:00Z', status: 'failed' },
    ]);

    expect(out[1]).toMatchObject({ id: 'remote-auto', name: 'Runs Elsewhere', enabled: false, runs_on: 'mac-b', source: 'edited' });
    expect(out[1]).not.toHaveProperty('last_runs');
  });
});

describe('compactSettings', () => {
  it('omits defaults and UI hint prose while keeping every non-default setting and env override', () => {
    const out = compactSettings({
      setup: {
        path: '~/.omni/omni.config.json',
        config: {
          version: 1,
          onboardedAt: '2026-10-01T10:00:00.000Z',
          user: { name: 'Ben', pronouns: 'they/them', timezone: '', email: '', work: '', tools: '' },
          workspace: { root: '', reposDir: '', githubOwner: 'ben-askphill' },
          integrations: { hermesUrl: '', centralBrainDir: '', tailscaleLogin: '', mcpPublicUrl: '', clerkPublishableKey: '', clerkClientId: '', mcpClients: '', syncSignatures: 'actions' },
          runOn: { device: '' },
          automations: { foo: { enabled: false } },
          crew: {},
          worktrees: { retention: { enabled: false, idleDays: 14 }, slim: { enabled: false, idleDays: 7 } },
        },
        resolved: { timezone: 'Europe/Amsterdam', workspaceRoot: '~/ws', reposDir: '~/repos', centralBrainDir: '', hermesUrl: '' },
        env: {},
      },
      server: {
        options: [
          { env: 'OMNI_PORT', section: 'machines', label: 'Port', hint: 'Where the server listens.', value: '4747', default: '4747', source: 'default' },
          { env: 'OMNI_MODS', section: 'threads', label: 'Mods', hint: 'Loads mods.', value: 'On', default: 'Off', source: 'env' },
        ],
      },
      display: { technical: true, shopify: false, openItems: false },
      analytics: { enabled: true, configured: false },
      usagePanel: { order: [], visible: {} },
    });

    expect(out).toEqual({
      path: '~/.omni/omni.config.json',
      config: {
        onboardedAt: '2026-10-01T10:00Z',
        user: { name: 'Ben' },
        workspace: { githubOwner: 'ben-askphill' },
      },
      resolved: { timezone: 'Europe/Amsterdam', workspaceRoot: '~/ws', reposDir: '~/repos' },
      server_options: [{ env: 'OMNI_MODS', value: 'On', default: 'Off' }],
      display: { technical: true },
    });
  });
});
