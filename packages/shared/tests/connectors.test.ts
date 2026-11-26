import { describe, expect, it } from 'vitest';
import { connectorAction, connectorFor, connectorGroups, connectorOf, connectorsUsed, prettyServer } from '../connectors.ts';
import { LINK_ICONS } from '../link-icons.ts';
import { turnSteps } from '../steps.ts';
import { buildItems, type ToolCall, type TranscriptEvent } from '../transcript-fold.ts';

let id = 0;
const ev = (kind: string, payload: unknown): TranscriptEvent => ({ id: ++id, kind, payload: JSON.stringify(payload), created_at: '2026-11-19T10:00:00.000Z' });
const tool = (tid: string, name: string, input: unknown = {}) => ev('tool_use', { id: tid, name, input, parent: null });
const out = (tid: string, text = 'ok', is_error = false) => ev('tool_result', { tool_use_id: tid, text, is_error, truncated: false });
const call = (name: string, result?: { is_error: boolean }, children: ToolCall[] = []): ToolCall =>
  ({ id: `${name}-${++id}`, name, input: {}, children, result: result ? { text: 'ok', truncated: false, ...result } : undefined }) as unknown as ToolCall;

describe('connector brands', () => {
  it('names claude.ai connectors, plugins and plain servers as people know them', () => {
    expect(connectorOf('mcp__claude_ai_Granola__search_meetings')).toMatchObject({ id: 'granola', name: 'Granola', mark: { type: 'letter', text: 'G' }, kind: 'connector' });
    expect(connectorOf('mcp__claude_ai_Notion__notion-search')).toMatchObject({ id: 'notion', name: 'Notion', mark: { type: 'logo', icon: 'notion' } });
    expect(connectorOf('mcp__claude_ai_Gmail__search_threads')?.name).toBe('Gmail');
    expect(connectorOf('mcp__gmail__search_emails')?.name).toBe('Gmail');
    expect(connectorOf('mcp__claude_ai_Google_Calendar__list_events')?.id).toBe('google-calendar');
    expect(connectorOf('mcp__google-calendar__list-events')?.id).toBe('google-calendar');
    expect(connectorOf('mcp__claude_ai_Google_Drive__search_files')?.id).toBe('google-drive');
    expect(connectorOf('mcp__claude_ai_Slack__slack_send_message')?.name).toBe('Slack');
    expect(connectorOf('mcp__claude_ai_Linear__list_issues')?.name).toBe('Linear');
    expect(connectorOf('mcp__claude_ai_Figma__get_screenshot')?.name).toBe('Figma');
    expect(connectorOf('mcp__plugin_github_github__create_pull_request')?.name).toBe('GitHub');
    expect(connectorOf('mcp__shopify-dev-mcp__search_docs_chunks')?.name).toBe('Shopify');
    expect(connectorOf('mcp__claude_ai_Vercel__list_projects')?.name).toBe('Vercel');
    expect(connectorOf('mcp__analytics-mcp__run_report')?.name).toBe('Google Analytics');
    expect(connectorFor('claude.ai Granola')?.id).toBe('granola');
    expect(connectorFor('plugin:github:github')?.id).toBe('github');
    expect(connectorOf('mcp__claude_ai_Claude_Docs__read')).toMatchObject({ name: 'Claude Docs', mark: { type: 'logo', icon: 'claude' } });
  });

  it('draws every logo it names from the icon set', () => {
    const names = ['notion', 'gmail', 'google_calendar', 'google_drive', 'slack', 'linear', 'figma', 'github', 'shopify', 'vercel', 'atlassian', 'spotify', 'todoist', 'excalidraw', 'box', 'google_analytics', 'claude_docs'];
    for (const n of names) {
      const mark = connectorFor(`claude_ai_${n}`)?.mark;
      expect(mark?.type, n).toBe('logo');
      if (mark?.type === 'logo') expect(LINK_ICONS[mark.icon], n).toBeDefined();
    }
  });

  it("treats Omni's own servers as Omni and the browser as no connector", () => {
    for (const s of ['omni', 'omni-admin', 'omni-ask', 'omni-steps', 'omni_render', 'omni-threads', 'omni-memory', 'omni-team']) expect(connectorFor(s)).toMatchObject({ id: 'omni', kind: 'omni', mark: { type: 'omni' } });
    expect(connectorOf('mcp__omni-browser__browser_click')).toBeNull();
    expect(connectorOf('mcp__plugin_playwright_playwright__browser_navigate')).toBeNull();
    expect(connectorOf('mcp__chrome-devtools__take_screenshot')).toBeNull();
  });

  it('leaves built-in tools alone', () => {
    for (const n of ['Bash', 'Read', 'Edit', 'Grep', 'WebSearch', 'Agent']) expect(connectorOf(n)).toBeNull();
  });

  it('falls back to a neutral mark and a tidied server name for a server it does not know', () => {
    expect(connectorOf('mcp__acme_crm__lookup')).toEqual({ id: 'mcp:acme_crm', name: 'Acme crm', mark: { type: 'generic' }, kind: 'connector' });
    expect(connectorOf('mcp__claude_ai_Ask_Phill_APA_Portal__whoami')).toMatchObject({ name: 'Ask Phill APA Portal', mark: { type: 'generic' } });
    expect(connectorOf('mcp__0b5e2a40-1111-4222-8333-944455556666__run')).toMatchObject({ name: 'Connected app', mark: { type: 'generic' } });
    expect(prettyServer('plugin_engineering_datadog')).toBe('Datadog');
    expect(prettyServer('__')).toBe('Connected app');
  });
});

describe('connector actions', () => {
  it('reads a tool name as words, without the app repeating itself', () => {
    expect(connectorAction('mcp__claude_ai_Granola__search_meetings')).toBe('Search meetings');
    expect(connectorAction('mcp__claude_ai_Notion__notion-search')).toBe('Search');
    expect(connectorAction('mcp__claude_ai_Slack__slack_send_message')).toBe('Send message');
    expect(connectorAction('mcp__claude_ai_Atlassian__getJiraIssue')).toBe('Get jira issue');
    expect(connectorAction('mcp__claude_ai_Notion__notion')).toBe('Notion');
    expect(connectorAction('mcp__acme__-')).toBe('Call');
  });
});

describe('connectors a thread used', () => {
  it('lists outside connectors once each, in first-use order, counting sub-agent calls', () => {
    const calls = [
      call('mcp__claude_ai_Granola__search_meetings', { is_error: false }),
      call('Bash', { is_error: false }),
      call('mcp__omni__list_threads', { is_error: false }),
      call('Agent', { is_error: false }, [call('mcp__claude_ai_Notion__notion-fetch', { is_error: true }), call('mcp__claude_ai_Granola__get_meetings')]),
    ];
    expect(connectorsUsed(calls).map((u) => [u.connector.name, u.calls, u.running, u.failed])).toEqual([
      ['Granola', 2, 1, 0],
      ['Notion', 1, 0, 1],
    ]);
  });

  it('groups one tool group by connector, top level only', () => {
    const calls = [call('mcp__claude_ai_Gmail__search_threads'), call('Read'), call('mcp__claude_ai_Gmail__get_thread'), call('mcp__claude_ai_Slack__slack_read_channel'), call('mcp__omni-steps__set_steps')];
    expect(connectorGroups(calls).map((g) => [g.connector.id, g.calls.length])).toEqual([
      ['gmail', 2],
      ['slack', 1],
    ]);
  });
});

describe('the step a connector call runs in', () => {
  it('says "Now: Using Granola" with its mark while the call runs, and drops it once it answers', () => {
    const steps = [{ title: 'Read the meeting notes', status: 'in_progress' }, { title: 'Write the summary' }];
    const head = [ev('user', { text: 'summarise' }), tool('s1', 'mcp__omni-steps__set_steps', { steps: steps.map((s) => s.title), current: 0 }), out('s1'), tool('g1', 'mcp__claude_ai_Granola__search_meetings', { keywords: ['kickoff'] })];
    const live = turnSteps(buildItems(head).items, { live: true });
    expect(live?.steps[0]).toMatchObject({ state: 'active', now: 'Using Granola', connector: { id: 'granola', name: 'Granola' } });
    const done = turnSteps(buildItems([...head, out('g1'), tool('b1', 'Bash', { command: 'ls', description: 'list files' })]).items, { live: true });
    expect(done?.steps[0].now).toBe('List files');
    expect(done?.steps[0].connector).toBeUndefined();
  });
});
