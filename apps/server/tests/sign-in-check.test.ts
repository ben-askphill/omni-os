import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import {
  CLAUDE_CONNECTORS_URL,
  connectorsIn,
  judge,
  neededConnectors,
  parseConnectorList,
  parseInitServers,
  parseMcpList,
  signInMessage,
} from '../connectors.ts';

// A4: a job that needs a connector that is signed out on this machine stops before any harness starts, says which one
// and how to sign in, and waits for Try again or Start anyway. A scheduled automation reports it once, then skips.

describe('connectors (pure)', () => {
  it('finds the connectors a brief names, narrowly', () => {
    expect(connectorsIn('Check my Slack for anything from the client and draft replies')).toEqual(['slack']);
    expect(connectorsIn('go through my inbox and the google calendar for tomorrow')).toEqual(['gmail', 'calendar']);
    expect(connectorsIn('Build a Slack app that posts deploys')).toEqual([]);
    expect(connectorsIn('Fix the Notion API integration test')).toEqual([]);
    expect(connectorsIn('Refactor the inbox component')).toEqual([]);
  });

  it('reads a role or automation list by id or label, and refuses an unknown one', () => {
    expect(parseConnectorList(['Slack', 'google calendar', 'slack'])).toEqual(['slack', 'calendar']);
    expect(parseConnectorList('gmail, drive')).toEqual(['gmail', 'drive']);
    expect(parseConnectorList(['jira'])).toMatch(/unknown connector "jira"/);
    expect(neededConnectors('check my calendar', ['slack'])).toEqual(['slack', 'calendar']);
  });

  it('reads both server lists Claude Code prints', () => {
    const init = parseInitServers(['claude.ai Slack:needs-auth', 'plugin:notion:notion:connected', 'omni:connected']);
    expect(init.get('plugin:notion:notion')).toBe('connected');
    const listed = parseMcpList(
      ['Checking MCP server health…', '', 'claude.ai Slack: https://mcp.slack.com - ! Needs authentication', 'claude.ai Gmail: https://gmail.mcp - ✔ Connected', 'plugin:x:x: npx x - ✘ Failed to connect'].join('\n'),
    );
    expect([...listed]).toEqual([
      ['claude.ai Slack', 'needs-auth'],
      ['claude.ai Gmail', 'connected'],
      ['plugin:x:x', 'failed'],
    ]);
  });

  it('holds only on a clear sign-out; a missing or failed server is unknown', () => {
    const servers = parseInitServers(['claude.ai Slack:needs-auth', 'claude.ai Gmail:connected', 'claude.ai Notion:failed']);
    const out = judge(['slack', 'gmail', 'notion', 'drive'], servers);
    expect(out.signedOut).toEqual([{ id: 'slack', label: 'Slack', url: CLAUDE_CONNECTORS_URL }]);
    expect(out.signedIn).toEqual(['gmail']);
    expect(out.unknown).toEqual(['notion', 'drive']);
    expect(judge(['slack'], null).unknown).toEqual(['slack']);
  });

  it('says what to do in plain words', () => {
    const text = signInMessage([{ id: 'slack', label: 'Slack', url: CLAUDE_CONNECTORS_URL }], 'omarchy');
    expect(text).toBe(`Slack is signed out on omarchy, so this job has not started and nothing was spent. Sign in to Slack at ${CLAUDE_CONNECTORS_URL}, then press Try again.`);
    expect(signInMessage([{ id: 'granola', label: 'Granola', url: null }], null)).toMatch(/running claude in a terminal and typing \/mcp/);
  });
});

const dir = mkdtempSync(join(tmpdir(), 'omni-signin-'));
const r = await startRunner({ OMNI_AUTOMATIONS_DIR: dir });
const check = await import('../sign-in-check.ts');
const automations = await import('../automations.ts');
const runner = await import('../runner.ts');

/** What `claude mcp list` says on this pretend machine; null: it did not answer. */
let mcpList: string | null = null;
let listCalls = 0;
const slackOut = 'claude.ai Slack: https://mcp.slack.com - ! Needs authentication';
const slackIn = 'claude.ai Slack: https://mcp.slack.com - ✔ Connected';

beforeEach(() => {
  listCalls = 0;
  check.configureSignInCheck({ reset: true, list: async () => (listCalls++, mcpList) });
});

describe('a thread whose connector is signed out', () => {
  it('waits before any harness starts, keeps its prompt, and starts on Try again once signed in', async () => {
    mcpList = slackOut;
    const t = await r.start('Check my Slack for anything from the client');
    await r.until('held', () => r.thread(t.id).setup === 'signin');
    expect(r.thread(t.id)).toMatchObject({ status: 'stopped', setup: 'signin' });
    expect(r.thread(t.id).setup_error).toMatch(/^Slack is signed out on .+, so this job has not started/);
    expect(r.spawns(t.id)).toHaveLength(0);
    mcpList = slackIn;
    check.configureSignInCheck({ reset: true });
    runner.retrySetup(t.id);
    await r.untilResults(t.id, 1);
    expect(r.thread(t.id).setup).toBeNull();
    expect(r.claudeTexts(t.id)[0]).toContain('Check my Slack');
  });

  it('starts anyway when told to, without checking again', async () => {
    mcpList = slackOut;
    const t = await r.start('Read my Slack and summarise it');
    await r.until('held', () => r.thread(t.id).setup === 'signin');
    const before = listCalls;
    runner.retrySetup(t.id, { skipSignIn: true });
    await r.untilResults(t.id, 1);
    expect(listCalls).toBe(before);
  });

  it('never holds a brief that names no connector, or one whose state is unknown', async () => {
    mcpList = slackOut;
    const plain = await r.start('Write a haiku about rain');
    await r.untilResults(plain.id, 1);
    expect(listCalls).toBe(0);
    mcpList = null;
    const unknown = await r.start('Check my Slack');
    await r.untilResults(unknown.id, 1);
    expect(r.thread(unknown.id).setup).toBeNull();
  });
});

describe('a scheduled automation whose connector is signed out', () => {
  writeFileSync(join(dir, 'digest.yaml'), 'name: Digest\nenabled: true\ncron: "0 7 * * *"\nchannel: scratch\nconnectors: [slack]\nprompt: Summarise overnight messages\n');
  const get = () => automations.loadAutomations().find((a) => a.id === 'digest')!;
  const runs = () => r.db.db.prepare(`SELECT thread_id, skip_reason FROM automation_runs WHERE automation = 'digest' ORDER BY id`).all() as any[];

  it('reads `connectors:` and refuses an unknown one', () => {
    expect(get().connectors).toEqual(['slack']);
    expect(automations.parseAutomation('x', 'cron: "0 2 * * *"\nprompt: p\nconnectors: [jira]').error).toMatch(/unknown connector/);
  });

  it('reports the first held run, skips the next ones quietly, and reports again after a sign-in', async () => {
    mcpList = slackOut;
    const first = await automations.fireScheduled(get());
    expect(first).not.toBeNull();
    await r.until('held', () => r.thread(first!.id).setup === 'signin');
    expect(await automations.fireScheduled(get())).toBeNull();
    expect(await automations.fireScheduled(get())).toBeNull();
    expect(runs().map((x) => [!!x.thread_id, x.skip_reason])).toEqual([
      [true, null],
      [false, expect.stringMatching(/^Slack still signed out on /)],
      [false, expect.stringMatching(/^Slack still signed out on /)],
    ]);
    mcpList = slackIn;
    check.configureSignInCheck({ reset: true });
    const ran = await automations.fireScheduled(get());
    await r.untilResults(ran!.id, 1);
    mcpList = slackOut;
    check.configureSignInCheck({ reset: true });
    const again = await automations.fireScheduled(get());
    expect(again).not.toBeNull();
    await r.until('held again', () => r.thread(again!.id).setup === 'signin');
  }, 20_000);
});
