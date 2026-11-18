import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startRunner } from './runner-boot.ts';

// Templates (apps/server/templates.ts): read from templates/ and data/templates/, the Shopify ones only while the
// Shopify add-on is on, listed in GET /api/templates and the `/` menu, and expanded into their instructions when a
// message starts with one.

const shipped = mkdtempSync(join(tmpdir(), 'omni-templates-'));
const file = (dir: string, name: string, src: string) => writeFileSync(join(dir, `${name}.md`), src);
file(shipped, 'client-qa', '---\nname: Client question\ndescription: Answer with sources\nargument-hint: <the question>\nkind: quick\n---\nAnswer this: $ARGUMENTS\n');
file(shipped, 'meeting-agenda', '---\nname: Meeting agenda\ndescription: Draft an agenda\nkind: task\n---\nDraft an agenda for $ARGUMENTS\n');
file(shipped, 'cro-audit', '---\nname: CRO audit\ndescription: Audit a store\nkind: task\npack: store\nskill: tdd\n---\nAudit $ARGUMENTS\n');
file(shipped, 'README', '# Not a template\n');
file(shipped, 'Bad Name', '---\nname: Bad\n---\nbody\n');
file(shipped, 'empty', '---\nname: Empty\n---\n');

const r = await startRunner({ OMNI_TEMPLATES_DIR: shipped });
const { allTemplates, listTemplates, parseTemplate, shopifyOn, templateList } = await import('../templates.ts');
const { templatesApi } = await import('../templates-api.ts');
const { commandsApi } = await import('../commands-api.ts');
const { db, kv } = await import('../db.ts');
const unset = () => db.prepare("DELETE FROM kv WHERE key = 'display'").run();
await (await import('../harness/catalog-service.ts')).loadCatalog();

const ids = (list: { id: string }[]) => list.map((t) => t.id).sort();

describe('the template files', () => {
  it('reads each Markdown file by its name, and leaves out a README, a bad name and an empty body', () => {
    expect(ids(allTemplates())).toEqual(['client-qa', 'cro-audit', 'meeting-agenda']);
    expect(allTemplates().find((t) => t.id === 'client-qa')).toEqual({
      id: 'client-qa',
      name: 'Client question',
      description: 'Answer with sources',
      argumentHint: '<the question>',
      kind: 'quick',
      pack: 'core',
      body: 'Answer this: $ARGUMENTS',
    });
  });

  it('defaults a file with no frontmatter to a quick core template named after the file', () => {
    expect(parseTemplate('notes', 'Sum up $ARGUMENTS')).toMatchObject({ id: 'notes', name: 'notes', kind: 'quick', pack: 'core' });
  });

  it("takes the user's own file over the shipped one with the same name", () => {
    const own = join(r.paths.data, 'templates');
    mkdirSync(own, { recursive: true });
    file(own, 'client-qa', '---\nname: Our client question\nkind: quick\n---\nOur way: $ARGUMENTS\n');
    try {
      expect(allTemplates().find((t) => t.id === 'client-qa')?.name).toBe('Our client question');
    } finally {
      file(own, 'client-qa', '');
    }
  });

  it('ships templates that all parse, with unique names, the Shopify ones in the store pack', async () => {
    const dir = resolve(import.meta.dirname, '../../../templates');
    const files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md');
    const { readFileSync } = await import('node:fs');
    const parsed = files.map((f) => parseTemplate(f.slice(0, -3), readFileSync(join(dir, f), 'utf8')));
    expect(parsed.every(Boolean)).toBe(true);
    expect(parsed.map((t) => t!.id).sort()).toEqual(['adr-from-meeting', 'client-qa', 'connect-store', 'cro-audit', 'meeting-agenda', 'meeting-recall', 'ticket-proposal']);
    expect(parsed.filter((t) => t!.pack === 'store').map((t) => t!.id).sort()).toEqual(['connect-store', 'cro-audit']);
    expect(parsed.every((t) => t!.description && t!.body.length > 40)).toBe(true);
  });
});

describe('the Shopify add-on', () => {
  it('is off on an install with no store channel, and the Shopify templates wait for it', () => {
    unset();
    expect(shopifyOn()).toBe(false);
    expect(ids(listTemplates())).toEqual(['client-qa', 'meeting-agenda']);
    expect(templateList()).toMatchObject({ shopify: false, hidden: 1 });
  });

  it('counts as on before it is set when a channel has a store domain, and follows the switch once it is', () => {
    r.db.channels.create({ id: 'shop', name: 'Shop', kind: 'client', use_worktree: 0, store_domain: 'shop.example' } as never);
    try {
      expect(shopifyOn()).toBe(true);
      kv.set('display', { technical: false, shopify: false });
      expect(shopifyOn()).toBe(false);
      kv.set('display', { technical: false, shopify: true });
      expect(ids(listTemplates())).toEqual(['client-qa', 'cro-audit', 'meeting-agenda']);
    } finally {
      r.db.channels.update('shop', { store_domain: '' });
      unset();
    }
  });
});

describe('GET /api/templates and the / menu', () => {
  it('lists the offered templates and how many wait for the add-on', async () => {
    const res = await templatesApi.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(ids(body.templates)).toEqual(['client-qa', 'meeting-agenda']);
    expect(body).toMatchObject({ shopify: false, hidden: 1 });
  });

  it('ends a new thread menu with the templates, as template rows', async () => {
    const res = await commandsApi.request('/?harness=claude-code&channel=scratch&wait=1');
    const { commands } = await res.json();
    const rows = commands.filter((c: { source: string }) => c.source === 'template');
    expect(rows.map((c: { name: string }) => c.name)).toEqual(['client-qa', 'meeting-agenda']);
    expect(rows[0]).toEqual({ name: 'client-qa', description: 'Answer with sources', argumentHint: '<the question>', source: 'template', mentionable: false });
  });
});

describe('a message that starts with a template', () => {
  it('reaches the harness as the instructions, and the user event keeps the text as typed with the template as its pill', async () => {
    const t = await r.start('/client-qa where is my order?');
    await r.untilResults(t.id, 1);
    const [u] = r.byKind(t.id, 'user');
    expect(u.p).toMatchObject({
      text: '/client-qa where is my order?',
      slash: { command: { name: 'client-qa', source: 'template', description: 'Answer with sources', argumentHint: '<the question>', start: 0, end: 10 } },
    });
    const [sent] = r.claudeTexts(t.id);
    expect(sent.startsWith('Template: Client question\n\nAnswer this: where is my order?')).toBe(true);
    expect(sent).toContain('This is a quick ask');
  });

  it('starts with its skill when the harness lists one, and is sent as typed when its pack is off', async () => {
    kv.set('display', { technical: false, shopify: true });
    try {
      const t = await r.start('/cro-audit shop.example');
      await r.untilResults(t.id, 1);
      expect(r.claudeTexts(t.id)[0].startsWith('/tdd Template: CRO audit\n\nAudit shop.example')).toBe(true);
      expect(r.byKind(t.id, 'user')[0].p.slash).toMatchObject({ command: { name: 'cro-audit', source: 'template' } });
    } finally {
      unset();
    }
    const off = await r.start('/cro-audit shop.example');
    await r.untilResults(off.id, 1);
    expect(r.claudeTexts(off.id)[0]).toBe('/cro-audit shop.example');
    expect(r.byKind(off.id, 'user')[0].p.slash).toBeUndefined();
  });

  it('expands a follow-up the same way', async () => {
    const t = await r.start('hello');
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, '/meeting-agenda the Q4 review');
    await r.untilResults(t.id, 2);
    expect(r.claudeTexts(t.id)[1]).toBe('Template: Meeting agenda\n\nDraft an agenda for the Q4 review');
  });
});
