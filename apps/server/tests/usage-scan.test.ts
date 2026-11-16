import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { waitFor } from './support.ts';

// The usage scan (apps/server/usage-scan/): Ben's own asks, grouped without a model; secrets masked before any text
// reaches Haiku or the lead; and one lead thread in the usage-scan role that suggests automations.

const r = await startRunner();
const { readAsks, SCAN_ROLE } = await import('../usage-scan/asks.ts');
const { cadence, clusterAsks, coveredBy, features, linkFeature, spread } = await import('../usage-scan/cluster.ts');
const { maskSecrets, MASK } = await import('../usage-scan/mask.ts');
const { labelPrompt, parseLabels } = await import('../usage-scan/labels.ts');
const { maskAsk, startUsageScan } = await import('../usage-scan/scan.ts');
const { app } = await import('../app.ts');
const { channels, db, events } = r.db;

channels.create({ id: 'acme', name: 'Acme', kind: 'client', use_worktree: 0, base_dir: r.tmp });
channels.create({ id: 'hush', name: 'Hush', kind: 'client', use_worktree: 0, base_dir: r.tmp });
channels.update('hush', { scan_opt_out: 1 });
channels.create({ id: 'imported', name: 'Imported history', kind: 'internal', use_worktree: 0, base_dir: r.tmp });

/** A Monday at 09:00 UTC eleven weeks ago, so every ask below falls in the last 90 days; then `week` weeks, `day` days and `hour` hours after it. */
const monday = new Date();
monday.setUTCHours(9, 0, 0, 0);
monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 77);
const T0 = monday.getTime();
const at = (week: number, day = 0, hour = 0) => new Date(T0 + week * 7 * 86_400_000 + day * 86_400_000 + hour * 3_600_000).toISOString();
const NOW = new Date(at(10));

let n = 0;
function thread(o: { channel?: string; source?: string; role?: string | null; automation?: string | null; parent?: string | null; title?: string } = {}) {
  const id = `t${++n}`;
  db.prepare(
    `INSERT INTO threads (id, channel_id, title, status, session_id, cwd, source, role, automation, parent_id) VALUES (?, ?, ?, 'done', ?, ?, ?, ?, ?, ?)`,
  ).run(id, o.channel ?? 'acme', o.title ?? `Thread ${n}`, id, r.tmp, o.source ?? 'manual', o.role ?? null, o.automation ?? null, o.parent ?? null);
  return id;
}
const say = (id: string, text: string, when: string, source = 'ben', extra: Record<string, unknown> = {}) => events.add(id, 'user', { text, source, ...extra }, when);
const ask = (text: string, when: string, o: Parameters<typeof thread>[0] = {}, extra: Record<string, unknown> = {}) => {
  const id = thread(o);
  say(id, text, when, o.source === 'import' ? 'import' : 'manual', extra);
  return id;
};

const GITHUB_TOKEN = `ghp_${'a1B2c3D4'.repeat(4)}`;
const STORED = 'Zq9-plain-store-value';

// Seven weekly asks to translate product copy, one with a token pasted in and one with a stored secret's value.
const translate = [0, 1, 2, 3, 4, 5, 6].map((w) =>
  ask(`Translate the Dutch product descriptions for Acme into German${w === 1 ? ` with token ${GITHUB_TOKEN}` : w === 4 ? ` using key ${STORED}` : ''} (${w})`, at(w, 0, 1)),
);
// A fork of the first one an hour later: the same ask again.
const fork = ask(`Translate the Dutch product descriptions for Acme into German (0)`, at(0, 0, 2));
// Six /review asks over six weeks.
const reviews = [0, 1, 2, 3, 5, 7].map((w) => ask(`/review PR ${w}`, at(w, 2, 3), {}, { slash: { command: { name: 'review' } } }));
// Six asks in one week: frequent, but not a habit over weeks.
const burst = [0, 1, 2, 3, 4, 5].map((d) => ask(`Deploy the staging hotfix for checkout ${d}`, at(8, d)));
// Not Ben's asks.
const nightly = thread({ source: 'automation', automation: 'nightly' });
say(nightly, 'Translate the Dutch product descriptions for Acme into German', at(3), 'automation');
say(nightly, 'Looks good, merge it', at(3, 0, 1), 'ben');
const underNightly = thread({ source: 'conductor', parent: nightly });
say(underNightly, 'Translate the Dutch product descriptions, follow-up from Ben', at(3, 1), 'ben');
const conductor = thread({ role: 'conductor', channel: 'conductor' });
say(conductor, 'Translate the Dutch product descriptions for Acme into French', at(5));
const crew = thread({ source: 'conductor', parent: conductor });
say(crew, 'Goal: translate the Dutch product descriptions', at(5), 'conductor');
say(crew, 'Use the glossary too', at(5, 0, 1), 'ben');
const scanThread = ask('# Usage scan: last 90 days', at(9), { role: SCAN_ROLE, channel: 'inbox' });
const hushed = ask('Translate the Dutch product descriptions for Hush', at(4), { channel: 'hush' });
const agentWritten = ask('You are a subagent. Translate the Dutch product descriptions for Acme', at(6));
const short = ask('ok', at(6));
const old = ask('Translate the Dutch product descriptions for Acme, long ago', at(-20));
// The same long prompt pasted into three threads: a template, kept out of the groups.
const template = 'Work through the checklist below for this store and report back. '.repeat(6);
const pasted = [1, 4, 7].map((w) => ask(`${template} Store ${w}`, at(w, 3), { source: 'import', channel: 'imported' }));

describe('masking', () => {
  it('masks tokens, URL passwords and key=value secrets by pattern', () => {
    const { text, masked } = maskSecrets(
      `push with ${GITHUB_TOKEN} to https://ben:hunter22@git.example.com/x and set API_KEY=abcdef123456, then Bearer abcdefghijklmnop`,
    );
    expect(text).not.toContain(GITHUB_TOKEN);
    expect(text).not.toContain('hunter22');
    expect(text).not.toContain('abcdef123456');
    expect(text).not.toContain('abcdefghijklmnop');
    expect(text).toContain(`https://ben:${MASK}@git.example.com/x`);
    expect(masked).toBe(4);
  });

  it('masks the exact values of stored secrets, which no pattern catches, and leaves short ones alone', () => {
    const { text, masked } = maskSecrets(`log in with ${STORED} then run it 1234 times`, [STORED, '1234']);
    expect(text).toBe(`log in with ${MASK} then run it 1234 times`);
    expect(masked).toBe(1);
  });

  it('masks private keys and leaves ordinary text as it is', () => {
    const key = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\ndef\n-----END OPENSSH PRIVATE KEY-----';
    expect(maskSecrets(`here: ${key}`).text).toBe(`here: ${MASK}`);
    const plain = 'Fix the cart drawer on /products/shoe and open a PR';
    expect(maskSecrets(plain)).toEqual({ text: plain, masked: 0 });
  });
});

describe('the asks query', () => {
  const scan = readAsks(db, { days: 90, now: NOW });
  const ids = scan.asks.map((a) => a.thread_id);

  it("keeps the first message of each thread Ben started, with the commands he used", () => {
    expect(ids).toEqual(expect.arrayContaining([...translate, ...reviews, ...burst]));
    expect(scan.asks.find((a) => a.thread_id === reviews[0])).toMatchObject({ text: '/review PR 0', commands: ['/review'], channel_id: 'acme' });
  });

  it('leaves out automation threads and every thread below one, Conductor and team threads, scans and opted-out channels', () => {
    for (const id of [nightly, underNightly, crew, scanThread, hushed]) expect(ids).not.toContain(id);
    // Ben's message to the Conductor is his own ask; the brief the Conductor wrote for its crewmate is not.
    expect(ids).toContain(conductor);
    expect(scan.left_out).toMatchObject({ automation: 2, delegated: 1, scan: 1, opted_out: 1 });
    expect(scan.opted_out).toEqual(['hush']);
  });

  it('leaves out agent-written and too-short asks, forks of an earlier ask, and threads from before the window', () => {
    for (const id of [agentWritten, short, fork, old]) expect(ids).not.toContain(id);
    expect(scan.left_out).toMatchObject({ agent_written: 1, short: 1, duplicate: 1 });
  });

  it('sets a long prompt pasted into 3 threads apart from the asks', () => {
    expect(scan.pasted).toHaveLength(1);
    expect(scan.pasted[0].asks.map((a) => a.thread_id)).toEqual(pasted);
    for (const id of pasted) expect(ids).not.toContain(id);
  });

  it('leaves out a thread continued from an automation run or an agent thread, however it got there', () => {
    // continue.ts starts the new thread with no parent, source manual and no automation, and records its first message
    // as Ben's even when the Conductor wrote it: only continued_from says where it came from.
    const continued = (from: string, text: string) => {
      const id = ask(text, at(7, 1));
      db.prepare('UPDATE threads SET continued_from = ? WHERE id = ?').run(from, id);
      return id;
    };
    const fromRun = continued(nightly, 'Translate the Dutch product descriptions for Acme into German again');
    const fromCrewOfRun = continued(underNightly, 'Translate the Dutch product descriptions, continued from the crewmate');
    const fromCrew = continued(crew, 'Translate the Dutch product descriptions with the glossary, continued');
    const twice = continued(fromCrew, 'Translate the Dutch product descriptions, continued twice');
    const fromBen = continued(translate[6], 'Translate the Dutch product descriptions for Acme, picking up where I left off');
    const scan = readAsks(db, { days: 90 });
    const ids = scan.asks.map((a) => a.thread_id);
    for (const id of [fromRun, fromCrewOfRun, fromCrew, twice]) expect(ids).not.toContain(id);
    // Continuing Ben's own thread is still his ask.
    expect(ids).toContain(fromBen);
    expect(scan.left_out).toMatchObject({ automation: 4, delegated: 3 });
    db.prepare(`DELETE FROM events WHERE thread_id IN (${[fromRun, fromCrewOfRun, fromCrew, twice, fromBen].map(() => '?').join(', ')})`).run(fromRun, fromCrewOfRun, fromCrew, twice, fromBen);
  });

  it('scans one channel when asked', () => {
    const one = readAsks(db, { days: 90, now: NOW, channel: 'conductor' });
    expect(one.asks.map((a) => a.thread_id)).toEqual([conductor]);
  });
});

describe('grouping', () => {
  const scan = readAsks(db, { days: 90, now: NOW });
  const clusters = clusterAsks(scan.asks, { timezone: 'UTC' });

  it('groups asks that share a command or a phrase over 3+ weeks, the strongest first', () => {
    expect(clusters.map((c) => c.kind)).toEqual(['phrase', 'command']);
    const [copy, review] = clusters;
    // Ben's own ask to the Conductor is the same work, so it joins the group.
    expect(copy.asks.map((a) => a.thread_id).sort()).toEqual([...translate, conductor].sort());
    expect(copy).toMatchObject({ id: 'C1', weeks: 7, channels: [{ id: 'acme', asks: 7 }, { id: 'conductor', asks: 1 }] });
    expect(review).toMatchObject({ id: 'C2', key: '/review', weeks: 6 });
    expect(review.asks.map((a) => a.thread_id)).toEqual(reviews);
  });

  it('never groups a burst inside one week', () => {
    for (const c of clusters) for (const id of burst) expect(c.asks.map((a) => a.thread_id)).not.toContain(id);
  });

  it('reads links as their site and drops paths, so a host or a home folder never forms a group', () => {
    expect(linkFeature('https://github.com/acme/shop/pull/12')).toBe('link:github.com/pull');
    expect(linkFeature('https://www.notion.so/page')).toBe('link:notion.so');
    const f = features({ text: 'Fix https://admin.shopify.com/store/acme/themes in /Users/ben/code/acme-theme now', commands: [] });
    expect(f.has('link:admin.shopify.com')).toBe(true);
    expect([...f].some((x) => x.includes('users') || x.includes('ben '))).toBe(false);
  });

  it('masks a token before reading features, so a pasted token never becomes a key', () => {
    const f = [...features({ text: `Rotate the billing webhook with ${GITHUB_TOKEN} today`, commands: [] })];
    expect(f.some((x) => x.includes('a1b2') || x.includes('ghp') || x.includes('masked'))).toBe(false);
    expect(f).toContain('billing webhook');
  });

  it('suggests a schedule an hour before the asks usually come in', () => {
    const weekdays = [0, 1, 2, 3, 4].map((d) => ({ at: at(d % 2, d, 1) }));
    expect(cadence(weekdays, 'UTC')).toMatchObject({ hour: 10, cron: '0 9 * * 1-5', label: 'weekdays at 09:00' });
    const mondays = [0, 1, 2, 3].map((w) => ({ at: at(w) }));
    expect(cadence(mondays, 'UTC')).toMatchObject({ day: 1, cron: '0 8 * * 1', label: 'Mondays at 08:00' });
  });

  it('spreads examples over the whole group and finds automations that already do the work', () => {
    expect(spread([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([1, 3, 6, 8]);
    expect(coveredBy({ key: '/review', kind: 'command' }, [{ id: 'pr-babysitter', name: 'PR babysitter', prompt: 'Run /review on new PRs' }])).toEqual(['pr-babysitter']);
  });

  it("drops a label for a group id Haiku made up", () => {
    const { labels, dropped } = parseLabels('C1 | Translate product copy | content\nC9 | Invented | x\n- C2 | Review PRs | code-review, agent-written', new Set(['C1', 'C2']));
    expect(dropped).toBe(1);
    expect(labels.get('C1')).toEqual({ what: 'Translate product copy', tags: ['content'], agentWritten: false });
    expect(labels.get('C2')).toEqual({ what: 'Review PRs', tags: ['code-review'], agentWritten: true });
  });
});

describe('the scan', () => {
  it('masks secrets before Haiku and the lead see any text, and starts one usage-scan thread in #inbox', async () => {
    const haikuSaw: string[] = [];
    const result = await startUsageScan(
      {},
      {
        secrets: async () => [STORED],
        ask: async (prompt) => {
          haikuSaw.push(prompt);
          return 'C1 | Translate product copy into German | marketing-content\nC7 | made up | x\nC2 | Review pull requests | code-review';
        },
      },
    );
    expect(result).toMatchObject({ groups: 2, pasted: 1, labelled: true });
    expect(result.masked).toBeGreaterThanOrEqual(2);
    expect(haikuSaw).toHaveLength(1);
    for (const secret of [GITHUB_TOKEN, STORED]) expect(haikuSaw[0]).not.toContain(secret);

    const t = r.thread(result.thread.id);
    expect(t).toMatchObject({ role: SCAN_ROLE, channel_id: 'inbox', source: 'manual' });
    expect(t.title).toMatch(/^Usage scan · /);
    const prompt = await waitFor(() => r.texts(t.id, 'user')[0], 'the scan prompt');
    for (const secret of [GITHUB_TOKEN, STORED]) expect(prompt).not.toContain(secret);
    expect(prompt).toContain(MASK);
    expect(prompt).toContain('Haiku: Translate product copy into German (marketing-content)');
    expect(prompt).toContain('### C2 · shares "/review"');
    expect(prompt).not.toContain('made up');
    // The scan's own thread is never one of Ben's asks next time.
    expect(readAsks(db, { days: 90 }).asks.map((a) => a.thread_id)).not.toContain(t.id);
  });

  it("never lets a stored secret's value name a group, and leaves an opted-out channel's automations out", async () => {
    // A stored value that looks like a word, in 6 asks over 6 weeks that share nothing else: unmasked, "via <value>"
    // would be the strongest phrase they share.
    const VAULT = 'tulip7orchard';
    ['Rotate billing webhooks', 'Reconnect inventory feed', 'Refresh analytics export', 'Restore shipping rates', 'Rebuild search index', 'Reload pricing sheet'].forEach(
      (task, w) => ask(`${task} via ${VAULT}`, at(w, 4, 2)),
    );
    expect(clusterAsks(readAsks(db, { days: 90 }).asks, { timezone: 'UTC' }).some((c) => c.key.includes(VAULT))).toBe(true);
    const save = (name: string, channel: string, prompt: string) =>
      app.request('/api/automations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: { name, enabled: false, cron: '0 9 * * 1', channel, prompt } }) });
    expect((await save('Hush weekly digest', 'hush', 'Summarize the hush pipeline')).status).toBe(201);
    expect((await save('Acme copy check', 'acme', 'Check the Acme product copy')).status).toBe(201);

    const haikuSaw: string[] = [];
    const result = await startUsageScan({}, { secrets: async () => [STORED, VAULT], ask: async (p) => (haikuSaw.push(p), null) });
    expect(result.groups).toBe(2);
    const prompt = await waitFor(() => r.texts(result.thread.id, 'user')[0], 'the scan prompt');
    for (const text of [prompt, ...haikuSaw]) expect(text).not.toContain(VAULT);
    expect(prompt).toContain('Acme copy check');
    expect(prompt).not.toMatch(/hush pipeline|Hush weekly/i);
  });

  it('keeps a stored secret used as a slash command out of the keys, the commands and both prompts', async () => {
    const BADGER = 'honeybadger';
    ['invoices', 'returns', 'reviews', 'coupons', 'payouts', 'bundles'].forEach((topic, w) =>
      ask(`/${BADGER} ${topic}`, at(w, 5, 4), {}, { slash: { command: { name: BADGER } } }),
    );
    const read = readAsks(db, { days: 90 }).asks;
    // Unmasked, the command would name a group of its own.
    expect(clusterAsks(read, { timezone: 'UTC' }).some((c) => c.key === `/${BADGER}`)).toBe(true);

    const asks = read.map((a) => maskAsk(a, [BADGER]).ask);
    const clusters = clusterAsks(asks, { timezone: 'UTC' });
    const haikuPrompt = labelPrompt(clusters.map((c) => ({ id: c.id, key: c.key, samples: c.asks.map((a) => a.text) })));
    for (const text of [haikuPrompt, ...clusters.map((c) => c.key), ...asks.flatMap((a) => [a.text, a.title, ...a.commands])]) expect(text).not.toContain(BADGER);

    const haikuSaw: string[] = [];
    const result = await startUsageScan({}, { secrets: async () => [STORED, BADGER], ask: async (p) => (haikuSaw.push(p), null) });
    const lead = await waitFor(() => r.texts(result.thread.id, 'user')[0], 'the scan prompt');
    expect(haikuSaw).toHaveLength(1);
    for (const text of [lead, ...haikuSaw]) expect(text).not.toContain(BADGER);
  });

  it('keeps an access key used as a slash command out of both prompts, though the command is lowercased', async () => {
    const AWS = 'AKIAABCDEFGHIJKLMNOP';
    [0, 1, 2, 3, 4, 5].forEach((w) => ask(`Rotate /${AWS} for request ${w}`, at(w, 6, 1)));
    expect(readAsks(db, { days: 90 }).asks.some((a) => a.commands.includes(`/${AWS.toLowerCase()}`))).toBe(true);
    const haikuSaw: string[] = [];
    const result = await startUsageScan({}, { secrets: async () => [], ask: async (p) => (haikuSaw.push(p), null) });
    const lead = await waitFor(() => r.texts(result.thread.id, 'user')[0], 'the scan prompt');
    for (const text of [lead, ...haikuSaw]) expect(text.toUpperCase()).not.toContain(AWS);
  });

  it('masks a stored value URL-encoded, form-encoded, in base64, JSON-escaped and with its spaces collapsed', async () => {
    const VALUE = 'R0se+Fi  eld="7"';
    const uri = encodeURIComponent(VALUE);
    const b64 = Buffer.from(VALUE).toString('base64');
    const forms = [
      uri,
      uri.toLowerCase(),
      uri.replace(/%20/g, '+'),
      b64,
      b64.replace(/=+$/, ''),
      Buffer.from(VALUE).toString('base64url'),
      JSON.stringify(VALUE).slice(1, -1),
      'R0se+Fi eld="7"',
    ];
    const line = forms.map((f, i) => `f${i}=${f}`).join(' ');
    [0, 1, 2, 3, 4, 5].forEach((w) => ask(`Check the ledger endpoint with ${line} run ${w}`, at(w, 6, 3)));
    const haikuSaw: string[] = [];
    const result = await startUsageScan({}, { secrets: async () => [VALUE], ask: async (p) => (haikuSaw.push(p), null) });
    const lead = await waitFor(() => r.texts(result.thread.id, 'user')[0], 'the scan prompt');
    // The group and its examples did reach both prompts.
    expect(lead).toContain('ledger endpoint');
    expect(haikuSaw[0]).toContain('ledger endpoint');
    // The scan collapses whitespace before it masks, so check each form that way too.
    const all = [...forms, ...forms.map((f) => f.replace(/\s+/g, ' '))];
    for (const text of [lead, ...haikuSaw]) for (const f of all) expect(text.toLowerCase()).not.toContain(f.toLowerCase());
  });

  it('goes on without labels when Haiku fails', async () => {
    const result = await startUsageScan({}, { secrets: async () => [], ask: async () => null });
    expect(result.labelled).toBe(false);
    const prompt = await waitFor(() => r.texts(result.thread.id, 'user')[0], 'the scan prompt');
    expect(prompt).toContain('Haiku could not label the groups');
  });

  it('refuses an opted-out channel, an unknown one, and one where nothing repeats', async () => {
    const post = (body: unknown) => app.request('/api/usage-scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post({ channel: 'hush' })).status).toBe(409);
    expect((await post({ channel: 'nope' })).status).toBe(404);
    const quiet = await post({ channel: 'scratch' });
    expect(quiet.status).toBe(409);
    expect(((await quiet.json()) as { error: string }).error).toMatch(/Nothing repeats enough/);
  });
});
