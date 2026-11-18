import { describe, it, expect } from 'vitest';
import { channelAccess, codexPolicy, harnessRefusal, judge, readOnlyCommand, readOnlyConnectorTool, unrestricted, type ChannelAccess } from '../access.ts';
import { approvalGrant, approvalQuestion, connectorIdOf, NEW_INSTALL_ACCESS } from '@omni/shared/access.ts';

// A6: what a tool call may do at each access level, the same for every harness that asks (ADR 0015).
const at = (level: ChannelAccess['level'], connectors: ChannelAccess['connectors'] = {}): ChannelAccess => ({ level, connectors });
const call = (tool: string, input: Record<string, unknown> = {}) => ({ tool, input, cwd: '/work/acme', threadDir: '/data/threads/t1' });

describe('the access policy', () => {
  it('lets every level read and search', () => {
    for (const level of ['read', 'ask', 'full'] as const) {
      for (const tool of ['Read', 'Grep', 'Glob', 'WebSearch', 'TodoWrite', 'Agent']) expect(judge(at(level), call(tool)).decision).toBe('allow');
      expect(judge(at(level), call('Bash', { command: 'git status && ls -la | head' })).decision).toBe('allow');
    }
  });

  it('refuses a write tool at read only, with words the agent cannot argue around', () => {
    const v = judge(at('read'), call('Write', { file_path: '/work/acme/notes.md', content: 'x' }));
    expect(v).toMatchObject({ decision: 'deny', reason: expect.stringContaining('read only') });
    expect(judge(at('read'), call('Bash', { command: 'rm -rf build' })).decision).toBe('deny');
    expect(judge(at('read'), call('Bash', { command: 'echo hi > out.txt' })).decision).toBe('deny');
    expect(judge(at('read'), call('mcp__claude_ai_Gmail__send_message', { to: 'a@b.c' })).decision).toBe('deny');
    expect(judge(at('read'), call('SomeNewTool')).decision).toBe('deny');
  });

  it("still lets every level write into Omni's own folder for the thread, where its artifacts go", () => {
    expect(judge(at('read'), call('Write', { file_path: '/data/threads/t1/artifacts/report.html' })).decision).toBe('allow');
  });

  it('asks first for commands, edits outside the folder and account actions, and runs edits inside it', () => {
    expect(judge(at('ask'), call('Edit', { file_path: '/work/acme/src/a.ts' })).decision).toBe('allow');
    expect(judge(at('ask'), call('Edit', { file_path: '/etc/hosts' }))).toMatchObject({ decision: 'ask', request: { tool: 'Edit', summary: '/etc/hosts' } });
    expect(judge(at('ask'), call('Bash', { command: 'npm publish' }))).toMatchObject({ decision: 'ask', request: { summary: 'npm publish' } });
    expect(judge(at('ask'), call('mcp__claude_ai_Gmail__create_draft', { to: 'x' }))).toMatchObject({ decision: 'ask', request: { connector: 'gmail' } });
    expect(judge(at('ask'), call('mcp__claude_ai_Gmail__search_threads', { q: 'x' })).decision).toBe('allow');
    // Files a tool later runs code from wait for a yes even inside the folder: a git hook, git config, a Claude Code hook.
    for (const file_path of ['/work/acme/.git/hooks/pre-commit', '/work/acme/.git/config', '/work/acme/.claude/settings.json', 'sub/.cursor/mcp.json', '/work/acme/.mcp.json', '/work/acme/.envrc']) {
      expect(judge(at('ask'), call('Write', { file_path })).decision).toBe('ask');
    }
    expect(judge(at('ask'), call('Write', { file_path: '/work/acme/.GIT/hooks/pre-commit' })).decision).toBe('ask');
    expect(judge(at('ask'), call('Write', { file_path: '/work/acme/docs/git-notes.md' })).decision).toBe('allow');
  });

  it('runs everything at full access', () => {
    expect(judge(at('full'), call('Bash', { command: 'rm -rf build' })).decision).toBe('allow');
    expect(unrestricted(at('full'))).toBe(true);
    expect(unrestricted(at('full', { gmail: 'read' }))).toBe(false);
  });

  it("gives a connector its own level, and off refuses even its reads, while Omni's own tools always run", () => {
    const a = at('full', { gmail: 'off', slack: 'ask' });
    expect(judge(a, call('mcp__claude_ai_Gmail__search_threads')).decision).toBe('deny');
    expect(judge(a, call('mcp__plugin_slack_slack__slack_send_message')).decision).toBe('ask');
    expect(judge(a, call('mcp__plugin_slack_slack__slack_read_channel')).decision).toBe('allow');
    expect(judge(a, call('Bash', { command: 'rm x' })).decision).toBe('allow');
    expect(judge(at('read'), call('mcp__omni-ask__ask_user_question')).decision).toBe('allow');
    expect(judge(at('ask', { browser: 'ask' }), call('mcp__omni-browser__browser_click')).decision).toBe('ask');
    expect(judge(at('ask'), call('mcp__omni-browser__browser_snapshot')).decision).toBe('allow');
  });

  it('reads a shell line as read only only when every part of it is', () => {
    expect(readOnlyCommand('rg -n foo src | head -5')).toBe(true);
    expect(readOnlyCommand('git log --oneline -3')).toBe(true);
    expect(readOnlyCommand('git push')).toBe(false);
    expect(readOnlyCommand('find . -name x -delete')).toBe(false);
    expect(readOnlyCommand('cat $(which sh)')).toBe(false);
    expect(readOnlyCommand('ls; curl -X POST x')).toBe(false);
    // Anything that could hide a second command asks (security review of #823).
    expect(readOnlyCommand('ls & rm -rf x')).toBe(false);
    expect(readOnlyCommand('ls &rm -rf x')).toBe(false);
    expect(readOnlyCommand('(rm -rf x)')).toBe(false);
    expect(readOnlyCommand('{ rm -rf x; }')).toBe(false);
    expect(readOnlyCommand('cat $HOME/.ssh/id_rsa')).toBe(false);
    expect(readOnlyCommand('cat ${IFS}x')).toBe(false);
    expect(readOnlyCommand('ls \\; rm x')).toBe(false);
    expect(readOnlyCommand("find . '-delete'")).toBe(false);
    expect(readOnlyCommand('find . -fls out.txt')).toBe(false);
    expect(readOnlyCommand('sort -uo out.txt in.txt')).toBe(false);
    expect(readOnlyCommand('sort --compress-program=sh in.txt')).toBe(false);
    expect(readOnlyCommand('rg --pre ./run.sh foo')).toBe(false);
    expect(readOnlyCommand('git -c core.pager=sh log')).toBe(false);
    expect(readOnlyCommand('git diff --ext-diff')).toBe(false);
    expect(readOnlyCommand('git diff --output=x.patch')).toBe(false);
    expect(readOnlyCommand("git 'push'")).toBe(false);
    expect(readOnlyCommand(`echo "'"$(touch x)"'"`)).toBe(false);
    expect(readOnlyCommand('sort --comp=sh in.txt')).toBe(false);
    expect(readOnlyCommand('sort --out=x in.txt')).toBe(false);
    expect(readOnlyCommand('git diff --ext')).toBe(false);
    expect(readOnlyCommand('git log --oneline')).toBe(true);
    // Single quotes keep reading commands reading.
    expect(readOnlyCommand("rg -n 'foo$' src")).toBe(true);
    expect(readOnlyCommand('grep -o foo file.txt')).toBe(true);
    expect(readOnlyConnectorTool('notion', 'notion-search')).toBe(true);
    expect(readOnlyConnectorTool('notion', 'notion-create-pages')).toBe(false);
  });

  it("makes a channel no looser than its thread's role, and reads a channel with no level as the machine's default", () => {
    expect(channelAccess({ access_level: 'full', connector_access: '{"slack":"full"}' }, 'read')).toEqual({ level: 'read', connectors: { slack: 'read' } });
    expect(channelAccess({ access_level: 'read', connector_access: null }, 'full').level).toBe('read');
    expect(channelAccess({ access_level: null, connector_access: null }, null, 'ask').level).toBe('ask');
    expect(channelAccess({ access_level: null, connector_access: null }, null, 'full').level).toBe('full');
    expect(NEW_INSTALL_ACCESS).toBe('ask');
  });

  it('maps every level onto Codex and refuses the harnesses Omni cannot hold to one', () => {
    expect(codexPolicy(at('read'))).toEqual({ approvalPolicy: 'never', sandbox: 'read-only' });
    expect(codexPolicy(at('ask'))).toEqual({ approvalPolicy: 'untrusted', sandbox: 'workspace-write' });
    expect(codexPolicy(at('full'))).toEqual({ approvalPolicy: 'never', sandbox: 'danger-full-access' });
    expect(harnessRefusal('hermes', at('ask'))).toMatch(/Hermes runs off this machine/);
    expect(harnessRefusal('cursor-cloud', at('read'))).toMatch(/Cursor Cloud/);
    expect(harnessRefusal('hermes', at('full'))).toBeNull();
    expect(harnessRefusal('codex', at('read'))).toBeNull();
  });

  it('names connectors from either form of their server name, and offers the role grant only with a role', () => {
    expect(connectorIdOf('claude.ai Gmail')).toBe('gmail');
    expect(connectorIdOf('claude_ai_Google_Calendar')).toBe('calendar');
    expect(connectorIdOf('plugin:slack:slack')).toBe('slack');
    expect(connectorIdOf('omni-browser')).toBe('browser');
    expect(connectorIdOf('linear')).toBeNull();
    const req = { tool: 'Bash', summary: 'npm publish', level: 'ask' as const };
    expect(approvalQuestion(req).options.map((o) => o.label)).toEqual(['Allow', 'Allow in this thread', 'Don’t allow']);
    expect(approvalQuestion(req, 'Builder').options.map((o) => o.label)).toContain('Always allow for Builder');
    expect(approvalQuestion(req).question).toBe('Run a command: npm publish');
    expect(approvalGrant({ selected: ['Always allow for Builder'], other: null })).toBe('role');
    expect(approvalGrant({ selected: [], other: 'not now' })).toBeNull();
    expect(approvalGrant({ selected: ['Don’t allow'], other: null })).toBeNull();
  });
});
