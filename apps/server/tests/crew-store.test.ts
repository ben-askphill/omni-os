import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// The crew store and /api/crew: built-ins in crew/ with the user's overlays in data/crew/, roles of the user's own,
// hiding, reset, and the thread create that refuses a role it cannot run as. The shipped files here are the test's
// own, so nothing reads or writes the repo's crew/.

const home = mkdtempSync(join(tmpdir(), 'omni-crew-home-'));
await startRunner({ HOME: home });
const { app } = await import('../app.ts');
const { paths } = await import('../config.ts');
const { charterHash, crewForNewThread, getCrew, listCrew } = await import('../crew.ts');
const { crewRunProblem } = await import('../crew-store.ts');
const { channels } = await import('../db.ts');
const { updateUserConfig } = await import('../user-config.ts');

const shipped = mkdtempSync(join(tmpdir(), 'omni-crew-shipped-'));
paths.crew = shipped;
const ship = (id: string, text: string) => writeFileSync(join(shipped, `${id}.md`), text);
const own = (id: string) => readFileSync(join(paths.personalCrew, `${id}.md`), 'utf8');
const writeOwn = (id: string, text: string) => {
  mkdirSync(paths.personalCrew, { recursive: true });
  writeFileSync(join(paths.personalCrew, `${id}.md`), text);
};

ship('conductor', '---\nname: Conductor\nchannel: conductor\nmcp: [omni]\ndelegate_only: true\ndelegatable: false\n---\nRoute everything.\n');
ship('usage-scan', '---\nname: Usage scan\nmcp: [omni]\ndelegate_only: true\ndelegatable: false\n---\nScan.\n');
ship('reviewer', '---\nname: Reviewer\nmodel: auto\n---\nReview the PR.\n');
ship('builder', '---\nname: Builder\ndescription: Writes code.\nmodel: auto\n---\nYou write and ship code.\n');

const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(`/api${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res: Response) => (await res.json()) as any;

describe('a built-in with an overlay', () => {
  it('adds to the shipped charter by default, sets only the fields it names, and keeps a release fix', async () => {
    const res = await send('PUT', '/crew/builder', { fields: { channel: 'inbox' }, charter: 'Use pnpm in every repo.' });
    expect(res.status).toBe(200);
    const detail = await json(res);
    expect(detail.role).toMatchObject({ kind: 'edited', charterMode: 'append', channel: 'inbox', model: 'auto', name: 'Builder' });
    expect(detail.role.charter).toBe('You write and ship code.\n\nUse pnpm in every repo.');
    expect(detail.role.builtInChanged).toBeUndefined();
    expect(own('builder')).toBe(`---\nchannel: inbox\ncharter_mode: append\nbased_on: ${charterHash('You write and ship code.')}\n---\nUse pnpm in every repo.\n`);

    // A release changes the shipped charter: the user's addition stays after it, and nothing asks to compare.
    ship('builder', '---\nname: Builder\ndescription: Writes code.\nmodel: auto\n---\nYou write, test and ship code.\n');
    expect(getCrew('builder')).toMatchObject({ charter: 'You write, test and ship code.\n\nUse pnpm in every repo.', channel: 'inbox' });
  });

  it('reads a hand copy with no mode as a replacement, and says when the built-in changed under it', async () => {
    writeOwn('reviewer', '---\nname: Reviewer\nmodel: auto\n---\nMy own review steps.\n');
    expect(getCrew('reviewer')).toMatchObject({ kind: 'edited', charterMode: 'replace', charter: 'My own review steps.', builtInChanged: true });

    // Saving the charter records the shipped one it was written against, which clears the notice.
    const saved = await json(await send('PUT', '/crew/reviewer', { charter: 'My own review steps, revised.' }));
    expect(saved.role).toMatchObject({ charterMode: 'replace', builtInChanged: false, charter: 'My own review steps, revised.' });
    expect(saved.shippedHash).toBe(charterHash('Review the PR.'));

    ship('reviewer', '---\nname: Reviewer\nmodel: auto\n---\nReview the PR against its brief.\n');
    expect(getCrew('reviewer')?.builtInChanged).toBe(true);
  });

  it('keeps frontmatter keys it does not know, such as a runtime binding a later build writes', async () => {
    writeOwn('builder', '---\n# mine\nruntime:\n  protocol: hermes\n  endpoint: https://agent.example.com\n  auth: secret:AGENT_TOKEN\ncharter_mode: append\n---\nUse pnpm.\n');
    await send('PUT', '/crew/builder', { fields: { model: 'opus' } });
    const text = own('builder');
    expect(text).toContain('# mine\nruntime:\n  protocol: hermes\n  endpoint: https://agent.example.com\n  auth: secret:AGENT_TOKEN\n');
    expect(text).toContain('model: opus');
    expect(text).toContain('Use pnpm.');
  });

  it('resets to the shipped role', async () => {
    const detail = await json(await send('POST', '/crew/builder/reset'));
    expect(detail.role.kind).toBe('shipped');
    expect(detail.own).toBeNull();
    expect((await send('POST', '/crew/builder/reset')).status).toBe(409);
  });

  it('keeps the routers routing', async () => {
    const off = await send('PUT', '/crew/conductor', { fields: { delegate_only: false } });
    expect(off.status).toBe(409);
    expect((await json(off)).error).toMatch(/only routes work, so it never gets working tools\. Leave delegate_only as the built-in has it\.$/);
    expect((await send('PUT', '/crew/usage-scan', { fields: { mcp: [] } })).status).toBe(409);
    // Adding to its charter is fine.
    expect((await send('PUT', '/crew/conductor', { charter: 'Reply in Dutch.' })).status).toBe(200);
    expect(getCrew('conductor')?.charter).toBe('Route everything.\n\nReply in Dutch.');
    await send('POST', '/crew/conductor/reset');
  });
});

describe('a role of the user own', () => {
  it('is created, listed, edited from markdown and deleted', async () => {
    const res = await send('POST', '/crew', { id: 'store-ops', fields: { name: 'Store ops', description: 'Store work.', channel: 'inbox' }, charter: 'You operate on stores.' });
    expect(res.status).toBe(201);
    expect((await json(res)).role).toMatchObject({ id: 'store-ops', kind: 'own', delegatable: true, charter: 'You operate on stores.' });
    expect(listCrew().map((r) => r.id)).toEqual(['conductor', 'builder', 'reviewer', 'store-ops', 'usage-scan']);

    const md = await send('PUT', '/crew/store-ops', { markdown: '---\nname: Store ops\nmodel: auto\n---\nDry run first.\n' });
    expect((await json(md)).role).toMatchObject({ model: 'auto', charter: 'Dry run first.' });

    expect((await send('POST', '/crew/store-ops/hidden', { hidden: true })).status).toBe(409);
    expect((await send('DELETE', '/crew/store-ops')).status).toBe(200);
    expect(getCrew('store-ops')).toBeUndefined();
  });

  it('refuses a taken, reserved or malformed id, a missing name, and run defaults this machine cannot run', async () => {
    const error = async (res: Response) => [res.status, (await json(res)).error];
    expect(await error(await send('POST', '/crew', { id: 'builder', fields: { name: 'B' } }))).toEqual([409, 'A role "builder" already exists.']);
    expect((await send('POST', '/crew', { id: 'Store Ops', fields: { name: 'S' } })).status).toBe(400);
    expect(await error(await send('POST', '/crew', { id: 'x', charter: 'no name' }))).toEqual([400, 'Give the role a name.']);
    expect((await error(await send('POST', '/crew', { id: 'x', fields: { name: 'X', harness: 'nope' } })))[1]).toMatch(/^Run defaults: unknown harness "nope" \(this machine has: /);
    expect(await error(await send('POST', '/crew', { id: 'x', fields: { name: 'X', channel: 'nowhere' } }))).toEqual([400, 'No channel "nowhere" for the role\'s default channel.']);
    expect((await error(await send('POST', '/crew', { id: 'x', fields: { name: 'X', mcp: ['shopify'] } })))[1]).toMatch(/Unknown MCP server "shopify"/);
    expect(await error(await send('PUT', '/crew/x', { charter: 'nothing here' }))).toEqual([404, 'No agent "x".']);
    expect(await error(await send('DELETE', '/crew/builder'))).toEqual([409, 'A built-in role cannot be deleted. Hide it, or reset your edit.']);
  });

  it('refuses every write from an agent thread', async () => {
    const res = await send('POST', '/crew', { id: 'sneaky', fields: { name: 'S' } }, { 'x-omni-thread': 'some-thread' });
    expect(res.status).toBe(403);
    expect((await send('POST', '/crew/builder/hidden', { hidden: true }, { 'x-omni-thread': 'some-thread' })).status).toBe(403);
    expect(getCrew('sneaky')).toBeUndefined();
  });
});

describe('Settings > Crew (S3)', () => {
  it('saves an avatar of a shared icon or an emoji with a hex background, and drops it on null', async () => {
    const res = await send('PUT', '/crew/builder', { fields: { avatar: { icon: 'icon:zap', bg: '#F5E6BA' } } });
    expect(res.status).toBe(200);
    expect((await json(res)).role.avatar).toEqual({ icon: 'icon:zap', bg: '#f5e6ba' });
    expect(own('builder')).toContain('avatar:\n  icon: icon:zap\n  bg: "#F5E6BA"');
    expect((await send('PUT', '/crew/builder', { fields: { avatar: { icon: '🛒' } } })).status).toBe(200);
    expect(getCrew('builder')?.avatar).toEqual({ icon: '🛒' });
    // An uploaded SVG would not read in a file, and a color must be hex.
    expect((await send('PUT', '/crew/builder', { fields: { avatar: { icon: 'svg:<svg/>' } } })).status).toBe(400);
    expect((await send('PUT', '/crew/builder', { fields: { avatar: { bg: 'amber' } } })).status).toBe(400);
    await send('PUT', '/crew/builder', { fields: { avatar: null } });
    expect(getCrew('builder')?.avatar).toBeUndefined();
    await send('POST', '/crew/builder/reset');
  });

  it('a field set back to null leaves the overlay, so the built-in sets it again', async () => {
    await send('PUT', '/crew/builder', { fields: { delegatable: false, mcp: ['omni'], delegate_only: true } });
    expect(getCrew('builder')).toMatchObject({ delegatable: false, delegateOnly: true, mcp: ['omni'] });
    await send('PUT', '/crew/builder', { fields: { delegatable: null, mcp: null, delegate_only: null } });
    expect(getCrew('builder')).toMatchObject({ delegatable: true, delegateOnly: false, mcp: [] });
    expect(own('builder')).not.toMatch(/delegatable|mcp|delegate_only/);
    await send('POST', '/crew/builder/reset');
  });

  it('shows the built-in alone and the charters as written beside the role', async () => {
    await send('PUT', '/crew/builder', { fields: { model: 'opus' }, charter: 'Use {{user}}\'s pnpm.' });
    const d = await json(await send('GET', '/crew/builder'));
    expect(d.builtIn).toMatchObject({ kind: 'shipped', model: 'auto', name: 'Builder' });
    expect(d.role.model).toBe('opus');
    expect(d.charters).toEqual({ builtIn: 'You write, test and ship code.', own: "Use {{user}}'s pnpm.", effective: "You write, test and ship code.\n\nUse {{user}}'s pnpm." });
    await send('POST', '/crew/builder/reset');
    expect((await json(await send('GET', '/crew/builder'))).charters).toEqual({ builtIn: 'You write, test and ship code.', own: null, effective: 'You write, test and ship code.' });
  });

  it('turns the form into the file and the file into the form without writing, keeping keys the form does not show', async () => {
    const saved = '---\nruntime: vps-agent\nmodel: opus\ncharter_mode: append\n---\nUse pnpm.\n';
    writeOwn('builder', saved);
    // The Markdown tab's text, edited: the form reads the role it makes.
    const typed = '---\nruntime: vps-agent\nmodel: opus\ndescription: Builds and tests.\ncharter_mode: append\n---\nUse pnpm. Run the tests.\n';
    const toForm = await send('POST', '/crew/draft', { id: 'builder', save: { markdown: typed } });
    expect(toForm.status).toBe(200);
    const read = (await json(toForm)).detail;
    expect(read.role).toMatchObject({ kind: 'edited', description: 'Builds and tests.', model: 'opus', charterMode: 'append' });
    expect(read.charters.own).toBe('Use pnpm. Run the tests.');
    // A form edit laid over that text keeps the key the form never shows, and the file's own edit.
    const md = (await json(await send('POST', '/crew/draft', { id: 'builder', own: typed, save: { fields: { effort: 'high' } } }))).markdown;
    expect(md).toBe('---\nruntime: vps-agent\nmodel: opus\ndescription: Builds and tests.\ncharter_mode: append\neffort: high\n---\nUse pnpm. Run the tests.\n');
    // Nothing is written.
    expect(own('builder')).toBe(saved);
    // A file that does not parse is refused rather than read as a blank form, and a new role has no id yet.
    expect((await send('POST', '/crew/draft', { id: 'builder', save: { markdown: '---\nmodel: [\n---\nx\n' } })).status).toBe(400);
    expect((await send('POST', '/crew/draft', { save: { markdown: '---\nname: [\n---\nx\n' } })).status).toBe(400);
    expect((await json(await send('POST', '/crew/draft', { save: { fields: { name: 'Store ops' }, charter: 'Dry run.' } }))).markdown).toBe('---\nname: Store ops\n---\nDry run.\n');
    expect((await send('POST', '/crew/draft', { id: 'nope', save: { fields: {} } })).status).toBe(404);
    await send('POST', '/crew/builder/reset');
  });

  it('duplicates a role into one of the user own, with the whole charter as written', async () => {
    await send('PUT', '/crew/builder', { fields: { model: 'opus', avatar: { icon: 'icon:tool' } }, charter: 'Use pnpm.' });
    const res = await send('POST', '/crew/builder/duplicate', { id: 'builder-two', name: 'Builder two' });
    expect(res.status).toBe(201);
    const copy = (await json(res)).role;
    expect(copy).toMatchObject({ id: 'builder-two', kind: 'own', name: 'Builder two', model: 'opus', description: 'Writes code.', avatar: { icon: 'icon:tool' } });
    expect(copy.charter).toBe('You write, test and ship code.\n\nUse pnpm.');
    expect(own('builder-two')).not.toMatch(/charter_mode|based_on/);
    // No name: "<name> copy". A taken or reserved id is refused.
    expect((await json(await send('POST', '/crew/builder/duplicate', { id: 'builder-three' }))).role.name).toBe('Builder copy');
    expect((await send('POST', '/crew/builder/duplicate', { id: 'builder-two' })).status).toBe(409);
    expect((await send('POST', '/crew/builder/duplicate', { id: 'reviewer' })).status).toBe(409);
    expect((await send('POST', '/crew/nope/duplicate', { id: 'nope-two' })).status).toBe(404);
    // Never from an agent thread: a copy carries the role's powers.
    expect((await send('POST', '/crew/builder/duplicate', { id: 'sneaky' }, { 'x-omni-thread': 'some-thread' })).status).toBe(403);
    for (const id of ['builder-two', 'builder-three']) await send('DELETE', `/crew/${id}`);
    await send('POST', '/crew/builder/reset');
  });
});

describe('hiding a built-in', () => {
  it('leaves it out of the list and refuses new threads as it, but a running thread keeps its charter', async () => {
    expect((await json(await send('POST', '/crew/reviewer/hidden', { hidden: true }))).role.hidden).toBe(true);
    expect((await json(await send('GET', '/crew'))).map((r: any) => r.id)).not.toContain('reviewer');
    expect((await json(await send('GET', '/crew?all=1'))).find((r: any) => r.id === 'reviewer')).toMatchObject({ hidden: true });
    expect(getCrew('reviewer')?.charter).toBeTruthy();

    const res = await send('POST', '/threads', { channel: 'inbox', role: 'reviewer', prompt: 'review it' });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatch(/^The agent "reviewer" is hidden on this machine\. Show it in Settings > Agents, or pick one of: /);

    await send('POST', '/crew/reviewer/hidden', { hidden: false });
    expect(getCrew('reviewer')?.hidden).toBe(false);
  });

  it('never hides the Conductor or usage-scan', async () => {
    expect((await send('POST', '/crew/conductor/hidden', { hidden: true })).status).toBe(409);
    expect((await send('POST', '/crew/usage-scan/hidden', { hidden: true })).status).toBe(409);
    // Not through the settings save either, nor a config file written by hand.
    await send('PUT', '/setup', { crew: { builder: { hidden: true } } });
    expect(getCrew('builder')?.hidden).toBe(false);
    updateUserConfig({ crew: { conductor: { hidden: true } } });
    expect(getCrew('conductor')?.hidden).toBe(false);
    updateUserConfig({ crew: { conductor: null } });
  });
});

describe('a new thread role', () => {
  it('refuses an id no role has, naming the valid ones, instead of running with no charter', async () => {
    const res = await send('POST', '/threads', { channel: 'inbox', role: 'biulder', prompt: 'fix it' });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('No agent "biulder". Agents: conductor, builder, reviewer, usage-scan.');
  });

  it('lets only delegatable roles take delegated work', () => {
    expect(crewForNewThread('usage-scan', true)).toEqual({ refused: 'The agent "usage-scan" cannot be delegated to. Agents: builder, reviewer.', status: 409 });
    expect(crewForNewThread('usage-scan', false)).toMatchObject({ role: { id: 'usage-scan' } });
    expect(crewForNewThread('builder', true)).toMatchObject({ role: { id: 'builder' } });
    expect(crewForNewThread(null, true)).toEqual({ role: null });
  });

  it('lists delegatable roles only to the Conductor', async () => {
    const crew = await json(await send('GET', '/crew'));
    expect(crew.filter((r: any) => r.delegatable).map((r: any) => r.id)).toEqual(['builder', 'reviewer']);
  });
});

describe('the runtime binding', () => {
  const harness = (id: string, models: string[] = []) => ({ id, name: id, available: true, models: models.map((m, i) => ({ id: m, default: i === 0, efforts: [] })) }) as any;

  it('takes any harness the catalog has, not a fixed list', () => {
    const cat = { harnesses: [harness('claude-code', ['opus']), harness('vps-agent')] };
    expect(crewRunProblem({ harness: 'vps-agent' }, cat)).toBeUndefined();
    expect(crewRunProblem({ harness: 'vps-agent', model: 'anything' }, cat)).toBeUndefined();
    expect(crewRunProblem({ harness: 'elsewhere' }, cat)).toBe('unknown harness "elsewhere" (this machine has: claude-code, vps-agent)');
  });

  it('loads a role whose harness this machine lacks, with an error rather than a crash', async () => {
    writeOwn('remote-ops', '---\nname: Remote ops\nharness: vps-agent\n---\nRuns elsewhere.\n');
    const role = (await json(await send('GET', '/crew'))).find((r: any) => r.id === 'remote-ops');
    expect(role).toMatchObject({ harness: 'vps-agent', kind: 'own' });
    expect(role.error).toMatch(/^unknown harness "vps-agent"/);
    expect(channels.get('inbox')).toBeTruthy();
  });
});
