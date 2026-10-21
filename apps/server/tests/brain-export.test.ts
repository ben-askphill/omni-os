import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('../db.ts', () => {
  throw new Error('db.ts must not be imported by brain-export tests');
});

import { emptyCursor, makeRedactor, plan, envSecretValues, NOTES_MAX, type Cursor, type Planned } from '../scripts/lib/brain-export.ts';

const SCHEMA = `
CREATE TABLE channels (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, repo_path TEXT, base_dir TEXT);
CREATE TABLE folders (id TEXT PRIMARY KEY, channel_id TEXT, parent_id TEXT, name TEXT NOT NULL);
CREATE TABLE threads (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, role TEXT,
  model TEXT, cwd TEXT NOT NULL, parent_id TEXT, task_id TEXT, source TEXT NOT NULL DEFAULT 'manual',
  harness TEXT NOT NULL DEFAULT 'claude-code', archived INTEGER NOT NULL DEFAULT 0, folder_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
  created_at TEXT NOT NULL, uid TEXT);
CREATE TABLE artifacts (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, name TEXT NOT NULL, url TEXT,
  description TEXT, created_at TEXT NOT NULL DEFAULT '2026-10-01');
`;

const T1 = '11111111-aaaa-4aaa-8aaa-000000000001';
let db: DatabaseSync;
let uid = 0;

function channel(id: string, kind = 'personal', repo: string | null = null) {
  db.prepare('INSERT INTO channels (id, name, kind, repo_path) VALUES (?, ?, ?, ?)').run(id, id.toUpperCase(), kind, repo);
}
function thread(id: string, over: Record<string, unknown> = {}) {
  const t = {
    channel_id: 'moby',
    title: 'Plan the engine',
    status: 'done',
    role: null,
    cwd: '/Users/ben/moby',
    parent_id: null,
    archived: 0,
    folder_id: null,
    created_at: '2026-10-14T09:26:42.000Z',
    updated_at: '2026-10-15T07:00:00.000Z',
    ...over,
  };
  db.prepare(
    `INSERT INTO threads (id, channel_id, title, status, role, model, cwd, parent_id, archived, folder_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'claude-opus-5-5', ?, ?, ?, ?, ?, ?)`,
  ).run(id, t.channel_id, t.title, t.status, t.role, t.cwd, t.parent_id, t.archived, t.folder_id, t.created_at, t.updated_at);
}
function ev(threadId: string, kind: string, payload: Record<string, unknown>) {
  const u = `uid-${++uid}`;
  db.prepare('INSERT INTO events (thread_id, kind, payload, created_at, uid) VALUES (?, ?, ?, ?, ?)').run(
    threadId,
    kind,
    JSON.stringify(payload),
    '2026-10-14T09:30:00.000Z',
    u,
  );
  return u;
}

const noRedact = (s: string) => s;
const run = (cursor: Cursor = emptyCursor(), extra: { channel?: string; since?: string } = {}) =>
  plan(db, { cursor, redact: noRedact, timezone: 'Europe/Amsterdam', ...extra });
const digests = (p: Planned[]) => p.flatMap((x) => ('digest' in x ? [x.digest] : []));
const skipOf = (p: Planned[], id: string) => p.find((x) => x.thread.id === id && 'skip' in x) as { skip: string } | undefined;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  uid = 0;
  channel('moby', 'personal', '/Users/ben/moby');
  channel('volero', 'client', '/Users/ben/apa-volero');
  channel('conductor', 'system');
  channel('testrepo', 'internal');
  channel('imported', 'internal');
});

describe('plan', () => {
  it('writes one digest per thread at omni/<channel>/<date>-<id8>.md with routing frontmatter', () => {
    db.prepare(`INSERT INTO folders (id, channel_id, parent_id, name) VALUES ('f1', 'moby', NULL, 'Research'), ('f2', 'moby', 'f1', 'Plan')`).run();
    thread(T1, { folder_id: 'f2' });
    ev(T1, 'user', { text: 'Build a stock engine', source: 'ben' });
    ev(T1, 'assistant_text', { text: 'Plan written.' });
    const last = ev(T1, 'result', { ok: true, subtype: 'success' });
    db.prepare(`INSERT INTO artifacts (thread_id, name, url, description) VALUES (?, 'plan.html', 'https://claude.ai/artifact/x', 'The plan')`).run(T1);

    const [d] = digests(run());
    expect(d.path).toBe('omni/moby/2026-10-14-11111111.md');
    expect(d.part).toBe(1);
    expect(d.lastUid).toBe(last);
    expect(d.content).toContain('channel_kind: "personal"');
    expect(d.content).toContain('folder: "Research / Plan"');
    expect(d.content).toContain(`last_event_uid: "${last}"`);
    expect(d.content).toContain('url: "https://claude.ai/artifact/x"');
    expect(d.content).toContain('### Ben · 2026-10-14 11:30\n\nBuild a stock engine');
    expect(d.content).toContain('#### Reply\n\nPlan written.');
  });

  it('drops tool calls, tool results, init, status and bash tasks', () => {
    thread(T1);
    ev(T1, 'init', { model: 'x', cwd: '/secret/place' });
    ev(T1, 'user', { text: 'go', source: 'ben' });
    ev(T1, 'tool_use', { name: 'Bash', input: { command: 'cat TOOL_INPUT_MARKER' } });
    ev(T1, 'tool_result', { text: 'TOOL_OUTPUT_MARKER' });
    ev(T1, 'status', { text: 'Approval requested' });
    ev(T1, 'task', { task_id: 'b1', event: 'started', task_type: 'local_bash', description: 'BASH_TASK_MARKER' });
    ev(T1, 'task', { task_id: 'a1', event: 'started', task_type: 'local_agent', subagent_type: 'Explore', description: 'Map the repo' });
    ev(T1, 'task', { task_id: 'a1', event: 'ended', status: 'completed', summary: 'Found three modules' });
    ev(T1, 'assistant_text', { text: 'done' });
    const { content } = digests(run())[0];
    for (const m of ['TOOL_INPUT_MARKER', 'TOOL_OUTPUT_MARKER', 'Approval requested', 'BASH_TASK_MARKER', '/secret/place']) {
      expect(content).not.toContain(m);
    }
    expect(content).toContain('_Subagent (Explore): Map the repo_');
    expect(content).toContain('_Subagent finished (completed): Found three modules_');
  });

  it('keeps the final reply of a turn in full and cuts the working notes before it', () => {
    thread(T1);
    ev(T1, 'user', { text: 'go', source: 'ben' });
    for (let i = 0; i < 10; i++) ev(T1, 'assistant_text', { text: `step ${i} ${'x'.repeat(300)}` });
    const final = `Final answer ${'y'.repeat(5000)}`;
    ev(T1, 'assistant_text', { text: final });
    ev(T1, 'result', { ok: true });
    const { content } = digests(run())[0];
    expect(content).toContain(`#### Reply\n\n${final}`);
    expect(content).toContain('step 0');
    expect(content).not.toContain('step 9');
    expect(content).toMatch(/more characters left out/);
    const notes = content.split('_Working notes:_')[1].split('#### Reply')[0];
    expect(notes.length).toBeLessThan(NOTES_MAX + 100);
  });

  it('labels briefs from the Conductor and keeps only the tail of crew reports', () => {
    const parent = '22222222-0000-4000-8000-000000000002';
    thread(parent, { channel_id: 'volero', title: 'Lead' });
    thread(T1, { parent_id: parent, title: 'Child' });
    ev(T1, 'user', { text: 'Do the import', source: 'conductor' });
    ev(T1, 'assistant_text', { text: 'ok' });
    ev(parent, 'user', { text: 'start', source: 'ben' });
    ev(parent, 'crew_report', { text: `HEAD_MARKER ${'z'.repeat(5000)} TAIL_MARKER`, thread_id: T1, title: 'Child', role: 'builder', channel: 'moby', status: 'done' });

    const all = digests(run());
    const child = all.find((d) => d.threadId === T1)!;
    const lead = all.find((d) => d.threadId === parent)!;
    expect(child.content).toContain('### Task brief (from the Conductor)');
    expect(child.content).toContain('Delegated from "Lead" (22222222).');
    expect(lead.content).toContain('Delegated to: "Child" (#moby, 11111111).');
    expect(lead.content).toContain('### Crew report from "Child" (builder, #moby) · done');
    expect(lead.content).toContain('TAIL_MARKER');
    expect(lead.content).not.toContain('HEAD_MARKER');
  });

  it('skips the test channel, running threads and archived noise', () => {
    const ids = {
      test: 'aaaaaaaa-0000-4000-8000-000000000001',
      running: 'aaaaaaaa-0000-4000-8000-000000000002',
      noise: 'aaaaaaaa-0000-4000-8000-000000000003',
      archivedDone: 'aaaaaaaa-0000-4000-8000-000000000004',
      conductor: 'aaaaaaaa-0000-4000-8000-000000000005',
      child: 'aaaaaaaa-0000-4000-8000-000000000006',
      answered: 'aaaaaaaa-0000-4000-8000-000000000007',
    };
    thread(ids.test, { channel_id: 'testrepo' });
    thread(ids.running, { status: 'running' });
    thread(ids.noise, { archived: 1, status: 'failed' });
    thread(ids.archivedDone, { archived: 1 });
    thread(ids.conductor, { channel_id: 'conductor', role: 'conductor' });
    thread(ids.child, { parent_id: ids.conductor });
    thread(ids.answered, { channel_id: 'conductor', role: 'conductor' });
    for (const id of Object.values(ids)) {
      ev(id, 'user', { text: 'hi', source: 'ben' });
      ev(id, 'assistant_text', { text: 'hello' });
    }
    ev(ids.archivedDone, 'result', { ok: true });

    const p = run();
    expect(skipOf(p, ids.test)?.skip).toBe('test-channel');
    expect(skipOf(p, ids.running)?.skip).toBe('running');
    expect(skipOf(p, ids.noise)?.skip).toBe('archived-noise');
    expect(digests(p).map((d) => d.threadId).sort()).toEqual([ids.archivedDone, ids.conductor, ids.child, ids.answered].sort());
  });

  it('exports a Conductor thread that delegated as a stub: Ben\'s messages and where the work went, nothing it wrote', () => {
    const lead = 'cccccccc-0000-4000-8000-000000000001';
    const kid1 = 'cccccccc-0000-4000-8000-000000000002';
    const kid2 = 'cccccccc-0000-4000-8000-000000000003';
    thread(lead, { channel_id: 'conductor', role: 'conductor' });
    thread(kid1, { parent_id: lead, title: 'Build the exporter' });
    db.prepare(`UPDATE threads SET task_id = 'T-CB2' WHERE id = ?`).run(kid1);
    ev(lead, 'user', { text: `Ben's whole original ask ${'w'.repeat(3000)}`, source: 'ben' });
    ev(lead, 'assistant_text', { text: 'CONDUCTOR_TEXT_MARKER' });
    ev(lead, 'crew_report', { text: 'CREW_REPORT_MARKER', thread_id: kid1, title: 'Build the exporter' });
    ev(lead, 'result', { ok: true });

    const [d] = digests(run()).filter((x) => x.threadId === lead);
    expect(d.content).toContain('digest: "delegation-stub"');
    expect(d.content).toContain(`Ben's whole original ask ${'w'.repeat(3000)}`);
    expect(d.content).toContain(`### Delegated\n\n- "Build the exporter": thread ${kid1}, task T-CB2, #moby`);
    expect(d.content).not.toContain('CONDUCTOR_TEXT_MARKER');
    expect(d.content).not.toContain('CREW_REPORT_MARKER');
    expect(d.content).not.toContain('#### Reply');

    // A later part carries only the new ask and the thread delegated since.
    const cursor: Cursor = { version: 1, threads: { [lead]: { uid: d.lastUid, part: 1 } } };
    db.prepare(`UPDATE events SET created_at = '2026-10-14T09:00:00.000Z' WHERE thread_id = ?`).run(lead);
    thread(kid2, { parent_id: lead, title: 'Second job', created_at: '2026-10-14T09:31:00.000Z' });
    ev(lead, 'user', { text: 'and one more thing', source: 'ben' });
    const [p2] = digests(run(cursor)).filter((x) => x.threadId === lead);
    expect(p2.part).toBe(2);
    expect(p2.content).toContain('and one more thing');
    expect(p2.content).toContain('"Second job"');
    expect(p2.content).not.toContain('"Build the exporter"');
  });

  it('routes imported history by its cwd, and to imported when nothing matches', () => {
    const matched = 'bbbbbbbb-0000-4000-8000-000000000001';
    const orphan = 'bbbbbbbb-0000-4000-8000-000000000002';
    thread(matched, { channel_id: 'imported', cwd: '/Users/ben/apa-volero/sub' });
    thread(orphan, { channel_id: 'imported', cwd: '/Users/ben/elsewhere' });
    for (const id of [matched, orphan]) ev(id, 'user', { text: 'hi', source: 'import' });

    const all = digests(run());
    const m = all.find((d) => d.threadId === matched)!;
    expect(m.path).toBe('omni/volero/2026-10-14-bbbbbbbb.md');
    expect(m.content).toContain('channel_kind: "client"');
    expect(all.find((d) => d.threadId === orphan)!.path).toBe('omni/imported/elsewhere/2026-10-14-bbbbbbbb.md');
    expect(digests(run(emptyCursor(), { channel: 'volero' })).map((d) => d.threadId)).toEqual([matched]);
  });

  it('skips imported history from temp dirs, scratchpads and worktrees', () => {
    const cwds = [
      '/private/tmp/claude-501/x/scratchpad',
      '/tmp/work',
      '/Users/ben/Library/Application Support/Claude/scratch-workspaces/a/b',
      '/Users/ben/proj/.claude/worktrees/feature-1',
      '/Users/ben/omni-os/data/worktrees/abc',
    ];
    cwds.forEach((cwd, i) => {
      const id = `dddddddd-0000-4000-8000-00000000000${i}`;
      thread(id, { channel_id: 'imported', cwd });
      ev(id, 'user', { text: 'hi', source: 'import' });
    });
    const p = run();
    expect(digests(p)).toEqual([]);
    expect(p.every((x) => 'skip' in x && x.skip === 'scratch-cwd')).toBe(true);
  });

  it('files imported history with no channel under imported/<project folder>, or the repo with the same folder name', () => {
    const ids = ['eeeeeeee-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000003', 'eeeeeeee-0000-4000-8000-000000000004'];
    thread(ids[0], { channel_id: 'imported', cwd: '/Users/ben/moneybot' });
    thread(ids[1], { channel_id: 'imported', cwd: '/Users/ben/.treehouse/fit-check-71bbec/1/fit-check' });
    thread(ids[2], { channel_id: 'imported', cwd: '/Users/ben/.treehouse/apa-volero-f1f1d5/1/apa-volero' });
    thread(ids[3], { channel_id: 'imported', cwd: '/Users/ben' });
    for (const id of ids) ev(id, 'user', { text: 'hi', source: 'import' });

    const by = new Map(digests(plan(db, { cursor: emptyCursor(), redact: noRedact, home: '/Users/ben' })).map((d) => [d.threadId, d]));
    expect(by.get(ids[0])!.path).toBe('omni/imported/moneybot/2026-10-14-eeeeeeee.md');
    expect(by.get(ids[0])!.content).toContain('imported_project: "moneybot"');
    expect(by.get(ids[1])!.path).toBe('omni/imported/fit-check/2026-10-14-eeeeeeee.md');
    expect(by.get(ids[2])!.path).toBe('omni/volero/2026-10-14-eeeeeeee.md');
    expect(by.get(ids[3])!.path).toBe('omni/imported/home/2026-10-14-eeeeeeee.md');
  });

  it('files the old coldblackcoffee folder under the Cold Black Coffee channel', () => {
    channel('cold-black-coffee', 'personal', '/Users/ben/coldblackcoffee-theme');
    const id = 'ffffffff-0000-4000-8000-000000000001';
    thread(id, { channel_id: 'imported', cwd: '/Users/ben/coldblackcoffee' });
    ev(id, 'user', { text: 'hi', source: 'import' });
    const [d] = digests(run());
    expect(d.path).toBe('omni/cold-black-coffee/2026-10-14-ffffffff.md');
    expect(d.content).toContain('channel_kind: "personal"');
    expect(d.content).not.toContain('imported_project');
  });

  it('exports only what is new after the cursor, as the next part', () => {
    thread(T1);
    ev(T1, 'user', { text: 'first ask', source: 'ben' });
    const first = ev(T1, 'assistant_text', { text: 'first answer' });
    const cursor: Cursor = { version: 1, threads: { [T1]: { uid: first, part: 1 } } };

    expect(skipOf(run(cursor), T1)?.skip).toBe('up-to-date');

    ev(T1, 'tool_use', { name: 'Read' });
    expect(skipOf(run(cursor), T1)?.skip).toBe('up-to-date');

    ev(T1, 'user', { text: 'second ask', source: 'ben' });
    ev(T1, 'assistant_text', { text: 'second answer' });
    const [d] = digests(run(cursor));
    expect(d.part).toBe(2);
    expect(d.path).toBe('omni/moby/2026-10-14-11111111-part2.md');
    expect(d.content).toContain(`previous_part_last_event_uid: "${first}"`);
    expect(d.content).toContain('second ask');
    expect(d.content).not.toContain('first ask');
  });

  it('flags a cursor whose event no longer exists instead of exporting the thread again', () => {
    thread(T1);
    ev(T1, 'user', { text: 'hi', source: 'ben' });
    expect(skipOf(run({ version: 1, threads: { [T1]: { uid: 'gone', part: 1 } } }), T1)?.skip).toBe('cursor-lost');
  });

  it('leaves out threads updated before --since', () => {
    thread(T1, { updated_at: '2026-09-01T00:00:00.000Z' });
    ev(T1, 'user', { text: 'hi', source: 'ben' });
    expect(run(emptyCursor(), { since: '2026-10-01' })).toEqual([]);
  });

  it('redacts the whole digest, frontmatter included', () => {
    thread(T1, { title: ['Use sk', '-ant-api03-', 'abcdefghijklmnopqrstuvwxyz0123'].join('') });
    ev(T1, 'user', { text: 'my key is hunter2-secret-value', source: 'ben' });
    const [d] = digests(plan(db, { cursor: emptyCursor(), redact: makeRedactor(['hunter2-secret-value']) }));
    expect(d.content).not.toContain('hunter2-secret-value');
    expect(d.content).not.toContain('sk-ant-api03');
    expect(d.content).toContain('title: "Use [REDACTED]"');
  });
});

describe('makeRedactor', () => {
  const redact = makeRedactor(['s3cr3t-value-from-keychain', 'abc']);

  it('replaces known secret values, but not ones too short to be safe to match', () => {
    expect(redact('token: s3cr3t-value-from-keychain.')).toBe('token: [REDACTED].');
    expect(redact('abc stays')).toBe('abc stays');
  });

  // Fake tokens, joined at runtime so GitHub push protection does not read them as real ones.
  const fake = (...parts: string[]) => parts.join('');
  it.each([
    [fake('shp', 'at_', '0123456789abcdef0123456789abcdef')],
    [fake('shp', 'ss_', '0123456789abcdef0123456789abcdef')],
    [fake('gh', 'p_', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')],
    [fake('github', '_pat_', '11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz')],
    [fake('sk', '-proj-', 'AbCdEf0123456789GhIjKlMn')],
    [fake('sk', '-ant-api03-', 'AbCdEf0123456789GhIjKlMn-xyz')],
    [fake('xo', 'xb-', '1234567890-abcdefghij')],
    [fake('AK', 'IA', 'ABCDEFGHIJKLMNOP')],
    [fake('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c')],
    ['9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'],
    ['Zm9vYmFyQmF6UXV4MTIzNDU2Nzg5MEFiQ2RFZkdo'],
  ])('redacts token shape %s', (token) => {
    expect(redact(`value ${token} end`)).toBe('value [REDACTED] end');
  });

  it('keeps the name of secret-looking assignments and headers', () => {
    expect(redact('export FINNHUB_API_KEY=d3abc123xyz')).toBe('export FINNHUB_API_KEY=[REDACTED]');
    expect(redact('Authorization: Bearer abcdefghijklmnop1234')).toBe('Authorization: Bearer [REDACTED]');
    expect(redact('postgresql://volero_ro:pa55word@db.example.com/x')).toBe('postgresql://volero_ro:[REDACTED]@db.example.com/x');
    expect(redact('VOLERO_STORE=volero-eu')).toBe('VOLERO_STORE=volero-eu');
  });

  it('keeps ids in URL paths, file names and ordinary text', () => {
    const keep = [
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/edit?gid=0',
      'https://github.com/askphill/apa-volero/blob/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b/README.md',
      '/private/tmp/claude-501/-Users-benrosenberg-omni-os-data-worktrees-f91bf8c4/scratchpad',
      '_Attached: IMG_20261014_AbCdEf0123456789GhIjKlMnOpQrSt.MOV_',
      'thread f91bf8c4-6578-48f3-b4a4-6a18608c0317 and commit 62c1094',
      'mcp__claude_ai_Google_Calendar__list_events_for_the_whole_week',
    ];
    for (const s of keep) expect(redact(s)).toBe(s);
  });

  it('still redacts a signature in a query string', () => {
    expect(redact('https://cdn.example.com/a.png?expires=1&signature=Zm9vYmFyQmF6UXV4MTIzNDU2Nzg5MEFiQ2RFZkdo')).toBe(
      'https://cdn.example.com/a.png?expires=1&signature=[REDACTED]',
    );
  });
});

describe('IP addresses and SSH details', () => {
  const redact = makeRedactor([]);

  it.each([
    ['public IPv4', 'server at 2.28.197.204 now', 'server at [REDACTED] now'],
    ['Tailscale IPv4 in a URL host', 'dashboard at http://100.110.128.38:8790/ratings', 'dashboard at http://[REDACTED]:8790/ratings'],
    ['private IPv4', 'router 192.168.1.20.', 'router [REDACTED].'],
    ['full IPv6', 'addr 2001:0db8:85a3:0000:0000:8a2e:0370:7334 up', 'addr [REDACTED] up'],
    ['compressed IPv6', 'tailnet fd7a:115c:a1e0::1234 ok', 'tailnet [REDACTED] ok'],
    ['IPv6 in brackets', 'http://[2001:db8::1]:8080/', 'http://[[REDACTED]]:8080/'],
  ])('redacts a %s', (_, input, out) => {
    expect(redact(input)).toBe(out);
  });

  it('leaves loopback, the any-address and lookalikes alone', () => {
    const keep = [
      'http://127.0.0.1:4747/api and localhost:4748',
      'listen on 0.0.0.0:8080',
      'curl http://[::1]:4747',
      'at 12:30:45 on 2026-10-14',
      'mac aa:bb:cc:dd:ee:ff',
      'python a[1::2]',
      'version 1.2.3 and 24.14.1',
      'std::vector<int>',
    ];
    for (const s of keep) expect(redact(s)).toBe(s);
  });

  it('redacts SSH key files, user@host targets, ssh URLs and host keys', () => {
    expect(redact('ssh -i /Users/ben/.ssh/cloudroom_hetzner_16180409 hermes@box.example.com')).toBe('ssh -i [REDACTED] [REDACTED]');
    expect(redact('ssh -i keys/deploy hermes@10.0.0.5 uptime')).toBe('ssh -i [REDACTED] [REDACTED] uptime');
    expect(redact('scp report.csv deploy@vps:/srv/')).toBe('scp report.csv [REDACTED]:/srv/');
    expect(redact('it lives in ~/.ssh/config')).toBe('it lives in [REDACTED]');
    expect(redact('generate id_ed25519 and id_rsa.pub')).toBe('generate [REDACTED] and [REDACTED]');
    expect(redact('use the server.pem key')).toBe('use the [REDACTED] key');
    expect(redact('clone ssh://git@github.com/ben/repo.git')).toBe('clone [REDACTED]');
    expect(redact('fingerprint SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8 ok')).toMatch(/^fingerprint (SHA256:)?\[REDACTED\] ok$/);
    expect(redact('a\nbox.example.com,1.2.3.4 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\nb')).toBe('a\n[REDACTED]\nb');
  });

  it('keeps emails off SSH lines and ids in URL paths', () => {
    const keep = ['mail ben@askphill.com today', 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/edit'];
    for (const s of keep) expect(redact(s)).toBe(s);
  });
});

describe('passwords in prose', () => {
  const redact = makeRedactor([]);

  it.each([
    ['The storefront password is hunter22 for now.', 'The storefront password is [REDACTED] for now.'],
    ['Storefront password: `tiwhoo`', 'Storefront password: `[REDACTED]`'],
    ['**Password:** `s3cret-map`', '**Password:** `[REDACTED]`'],
    ['the password for the store is opensesame', 'the password for the store is [REDACTED]'],
    ['dev store (password `blueberry`)', 'dev store (password `[REDACTED]`)'],
    ['wachtwoord: geheim123', 'wachtwoord: [REDACTED]'],
  ])('redacts the value in %s', (input, out) => {
    expect(redact(input)).toBe(out);
  });

  it('leaves prose about passwords alone', () => {
    const keep = [
      'The store is password protected, so I can\'t render it.',
      'The password is now in Omni secrets.',
      'password is in `~/notes/store.md`',
      'Enter the storefront password in the Online Store tab.',
      'security find-generic-password -s omni-os -a global/X -w',
    ];
    for (const s of keep) expect(redact(s)).toBe(s);
  });
});

describe('envSecretValues', () => {
  it('collects values of env vars named like secrets', () => {
    expect(envSecretValues({ GITHUB_TOKEN: 'a', HOME: '/Users/ben', DB_PASSWORD: 'b', EMPTY_KEY: '' }).sort()).toEqual(['a', 'b']);
  });
});
