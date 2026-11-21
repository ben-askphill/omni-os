import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentFace } from '@omni/shared/agent-avatar.ts';
import { AGENT_PALETTE } from '@omni/shared/avatar-color.ts';
import { startRunner } from './runner-boot.ts';

// The one-time step that switches agents with a shared glyph icon (`icon:<name>`) to their crew characters (ADR 0021,
// D3 and D26), on a booted server over its own data folder. Every crew file here is made up for the test.

const r = await startRunner();
const { app } = await import('../app.ts');
const { paths } = await import('../config.ts');
const { migrateCrewAvatars } = await import('../crew-avatar-migrate.ts');

const shipped = mkdtempSync(join(tmpdir(), 'omni-avatar-migrate-shipped-'));
paths.crew = shipped;
const ship = (id: string, text: string) => writeFileSync(join(shipped, `${id}.md`), text);
ship('conductor', '---\nname: Conductor\nchannel: conductor\nmcp: [omni]\ndelegate_only: true\ndelegatable: false\n---\nRoute everything.\n');
ship('builder', '---\nname: Builder\nmodel: auto\n---\nYou write and ship code.\n');
ship('reviewer', '---\nname: Reviewer\nmodel: auto\nreview: true\n---\nReview the PR.\n');
ship('usage-scan', '---\nname: Usage scan\nmcp: [omni]\ndelegate_only: true\ndelegatable: false\n---\nScan.\n');

mkdirSync(paths.personalCrew, { recursive: true });
const ownPath = (id: string) => join(paths.personalCrew, `${id}.md`);
const own = (id: string, text: string) => (writeFileSync(ownPath(id), text), text);
const fileOf = (id: string) => readFileSync(ownPath(id), 'utf8');

// Overlays on built-ins and a role of the user's own, each with a shared glyph, three of them on a color outside the 14.
own('builder', '---\ndescription: Ships the fix.\ncharter_mode: append\nbased_on: 0a1b2c3d4e5f\nmcp:\n  - omni\navatar:\n  icon: icon:tool\n  bg: "#ffa424"\n---\nRun the linter before you push.\n');
own('conductor', '---\navatar:\n  icon: icon:play\n  bg: "#1e1e1e"\ncharter_mode: append\nbased_on: 1b2c3d4e5f6a\n---\nAsk before a long job.\n');
own('designer', '---\nname: Designer\ndescription: Critiques and polishes interfaces.\navatar:\n  icon: icon:image\n  bg: "#d4e9fa"\n---\nStart from the design system.\n');
own('reviewer', '---\navatar:\n  icon: icon:check\ncharter_mode: append\nbased_on: 2c3d4e5f6a7b\n---\n');
own('usage-scan', '---\navatar:\n  icon: icon:gauge\ncharter_mode: append\nbased_on: 3d4e5f6a7b8c\n---\n');
// A shared glyph on a color from the 14: the icon goes, the color stays.
own('teller', '---\nname: Teller\navatar:\n  icon: icon:globe\n  bg: "#52cdfe"\n---\nCount twice.\n');

/** A 1px square PNG, as an upload or a remote agent's server gives one. */
const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SVG = 'svg:<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#123456"/></svg>';
// Picked one by one: none of these changes, not even a glyph an uploaded photo covers.
const kept = {
  baker: own('baker', '---\nname: Baker\navatar:\n  icon: "🍞"\n  bg: "#f5e6ba"\n---\nProof the dough.\n'),
  drawer: own('drawer', `---\nname: Drawer\navatar:\n  icon: '${SVG}'\n  bg: "#e8d9f5"\n---\nSketch first.\n`),
  portrait: own('portrait', `---\nname: Portrait\navatar:\n  image: ${PHOTO}\n  icon: icon:image\n  bg: "#d4e9fa"\n---\nSmile.\n`),
  // A hand edit gone wrong: the frontmatter does not parse, so Omni reads none of its keys, and the file stays for Ben to fix.
  broken: own('broken', '---\nname: [Broken\navatar:\n  icon: icon:tool\n---\nFix me.\n'),
  relay: own('relay', `---\nname: Relay\nharness: hermes\nmodel: hermes\navatar:\n  image: ${PHOTO}\navatar_offered: ${createHash('sha256').update(PHOTO).digest('hex').slice(0, 12)}\n---\n`),
};

const api = async (path: string) => (await app.request(`/api${path}`)).json() as Promise<any>;
const colorName = (hex: string) => AGENT_PALETTE.find((c) => c.hex === hex)?.name ?? hex;
/** What the agent's avatar draws, as the Web UI and the iOS app read the API. */
const face = async (id: string) => {
  const role = (await api('/crew?all=1')).find((x: any) => x.id === id);
  const f = agentFace(role, { size: 32 });
  return f.kind === 'character' ? { kind: f.kind, shape: f.shape, color: colorName(f.body) } : { kind: f.kind };
};

// Sync is set up on this machine, so every write it records goes out to the other machines.
r.db.outbox.arm('mac-a');
const queued = () => (r.db.db.prepare(`SELECT entity_id, op FROM sync_outbox WHERE entity = 'crew_file' ORDER BY entity_id`).all() as { entity_id: string; op: string }[]).map((c) => `${c.entity_id} ${c.op}`);

describe('the first start with crew characters', () => {
  migrateCrewAvatars();

  it('switches agents with a shared glyph to their characters, dropping a color outside the 14', async () => {
    for (const id of ['builder', 'conductor', 'designer', 'reviewer', 'usage-scan']) expect((await api(`/crew/${id}`)).role.avatar?.icon).toBeUndefined();
    expect(await face('builder')).toEqual({ kind: 'character', shape: 'squircle', color: 'Amber' });
    expect(await face('conductor')).toEqual({ kind: 'character', shape: 'circle', color: 'Ink' });
    expect(await face('designer')).toEqual({ kind: 'character', shape: 'bucket', color: 'Amber' });
    expect(await face('reviewer')).toEqual({ kind: 'character', shape: 'pill-wide', color: 'Violet' });
    expect(await face('usage-scan')).toEqual({ kind: 'character', shape: 'pill-tall', color: 'Sun' });
  });

  it('keeps a color from the agent palette, and leaves emoji, SVG, photo and offered avatars as they were', async () => {
    expect((await api('/crew/teller')).role.avatar).toEqual({ bg: '#52cdfe' });
    expect((await face('teller')).color).toBe('Sky');
    for (const [id, text] of Object.entries(kept)) expect(fileOf(id), id).toBe(text);
    expect(await face('baker')).toEqual({ kind: 'icon' });
    expect(await face('drawer')).toEqual({ kind: 'icon' });
    expect(await face('portrait')).toEqual({ kind: 'image' });
  });

  it('keeps every other key and the charter as written', async () => {
    expect(fileOf('builder')).toBe('---\ndescription: Ships the fix.\ncharter_mode: append\nbased_on: 0a1b2c3d4e5f\nmcp:\n  - omni\n---\nRun the linter before you push.\n');
    expect(fileOf('reviewer')).toBe('---\ncharter_mode: append\nbased_on: 2c3d4e5f6a7b\n---\n');
    expect((await api('/crew/builder')).role).toMatchObject({ kind: 'edited', charterMode: 'append', description: 'Ships the fix.', mcp: ['omni'], charter: 'You write and ship code.\n\nRun the linter before you push.' });
    expect((await api('/crew/conductor')).role).toMatchObject({ kind: 'edited', charterMode: 'append', delegateOnly: true, charter: 'Route everything.\n\nAsk before a long job.' });
    expect((await api('/crew/designer')).role).toMatchObject({ kind: 'own', name: 'Designer', description: 'Critiques and polishes interfaces.', charter: 'Start from the design system.' });
  });

  it('records a sync change for each file it rewrote, and none for the rest', () => {
    expect(queued()).toEqual(['builder upsert', 'conductor upsert', 'designer upsert', 'reviewer upsert', 'teller upsert', 'usage-scan upsert']);
  });
});

describe('a later start', () => {
  it('does nothing, so an icon picked since stays', async () => {
    // Ben picks a glyph for Builder again in Settings > Agents.
    const pick = await app.request('/api/crew/builder', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: { avatar: { icon: 'icon:tool', bg: '#ffa424' } } }) });
    expect(pick.status).toBe(200);
    const files = Object.fromEntries(['builder', 'conductor', 'designer', 'reviewer', 'usage-scan', 'teller', ...Object.keys(kept)].map((id) => [id, fileOf(id)]));
    const before = queued();

    expect(migrateCrewAvatars()).toEqual([]);
    for (const [id, text] of Object.entries(files)) expect(fileOf(id), id).toBe(text);
    expect(queued()).toEqual(before);
    expect(await face('builder')).toEqual({ kind: 'icon' });
  });
});
