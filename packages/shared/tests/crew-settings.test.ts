import { describe, expect, it } from 'vitest';
import { blankCrewDraft, CHANGED_CHARTER_ACTIONS, crewChips, crewDraftOf, crewDraftProblem, crewIdFrom, crewMarkdownOf, crewRunLine, crewSaveBody, crewTools, lineDiff, memoryScope, remoteRoleNote, type CrewDetailView, type CrewListed } from '../crew-settings.ts';

const role = (over: Partial<CrewListed> = {}): CrewListed => ({ id: 'builder', name: 'Builder', description: 'Writes code.', model: 'auto', mcp: [], delegateOnly: false, delegatable: true, review: false, kind: 'shipped', hidden: false, ...over });

const detail = (r: CrewListed, builtIn: CrewListed | null, own: string | null = null): CrewDetailView => ({
  role: r,
  builtIn,
  shipped: builtIn ? '---\nname: Builder\n---\nShip code.\n' : null,
  own: own === null ? null : `---\n---\n${own}\n`,
  shippedHash: builtIn ? 'abc' : null,
  charters: { builtIn: builtIn ? 'Ship code.' : null, own, effective: builtIn ? ['Ship code.', own].filter(Boolean).join('\n\n') : (own ?? '') },
});

describe('the list', () => {
  it('names where a role comes from, then what needs a look', () => {
    expect(crewChips(role()).map((c) => c.label)).toEqual(['Built-in']);
    expect(crewChips(role({ kind: 'edited', charterMode: 'replace', builtInChanged: true, hidden: true })).map((c) => [c.label, c.tone])).toEqual([
      ['Edited', 'default'],
      ['Hidden', 'outline'],
      ['Built-in charter changed', 'default'],
    ]);
    expect(crewChips(role({ kind: 'own', error: 'unknown harness "vps"' })).map((c) => [c.label, c.title])).toEqual([
      ['Yours', 'An agent of your own, in data/crew/.'],
      ["Can't run here", 'unknown harness "vps"'],
    ]);
  });

  it('says the run in one line', () => {
    expect(crewRunLine({ model: 'auto' })).toBe('Auto');
    expect(crewRunLine({})).toBe('Auto, or the channel default');
    expect(crewRunLine({ harness: 'codex', model: 'gpt-6.1-sol', effort: 'high' }, { harness: () => 'Codex', model: () => 'GPT 6.1 Sol' })).toBe('Codex · GPT 6.1 Sol · high');
    expect(crewRunLine({ harness: 'vps-agent' })).toBe('vps-agent · its default model');
  });

  it('makes an id from a name', () => {
    expect(crewIdFrom('Store ops')).toBe('store-ops');
    expect(crewIdFrom('  Ünïcode & co!  ')).toBe('unicode-co');
  });
});

describe('the editor', () => {
  it('reads a built-in nobody edited as adding to its charter', () => {
    const d = crewDraftOf(detail(role(), role()));
    expect(d).toMatchObject({ name: 'Builder', model: 'auto', charter: '', charterMode: 'append', conductorTools: false });
  });

  it('sends only what changed on a built-in, and empties a field set back to the built-in', () => {
    const builtIn = role();
    const edited = role({ kind: 'edited', model: 'opus', channel: 'inbox', charterMode: 'append' });
    const d = { ...crewDraftOf(detail(edited, builtIn, 'Use pnpm.')), model: 'auto', description: 'Writes and tests code.' };
    expect(crewSaveBody(d, detail(edited, builtIn, 'Use pnpm.'))).toEqual({
      fields: { model: '', description: 'Writes and tests code.' },
    });
  });

  it('leaves the charter and its mode out of a save that did not change them, so Built-in charter changed stays', () => {
    const builtIn = role();
    const changed = role({ kind: 'edited', charterMode: 'replace', builtInChanged: true });
    const view = detail(changed, builtIn, 'My whole charter.');
    const body = crewSaveBody({ ...crewDraftOf(view), description: 'Reviews code.' }, view);
    expect(body).toEqual({ fields: { description: 'Reviews code.' } });
    expect(body).not.toHaveProperty('charter');
    expect(body).not.toHaveProperty('charter_mode');
    // A charter edit, or a switch to adding, still goes.
    expect(crewSaveBody({ ...crewDraftOf(view), charter: 'My new charter.' }, view)).toEqual({ fields: {}, charter: 'My new charter.' });
    expect(crewSaveBody({ ...crewDraftOf(view), charterMode: 'append' }, view)).toEqual({ fields: {}, charter_mode: 'append' });
    // An unedited built-in sends nothing for its charter: the server starts the overlay as an addition.
    expect(crewSaveBody({ ...crewDraftOf(detail(role(), builtIn)), effort: 'high' }, detail(role(), builtIn))).toEqual({ fields: { effort: 'high' } });
  });

  it('sends a switch or list set back to the built-in as null, and only the avatar keys that changed', () => {
    const builtIn = role();
    const edited = role({ kind: 'edited', delegatable: false, mcp: ['omni'], delegateOnly: true, avatar: { icon: 'icon:zap' } });
    const d = { ...crewDraftOf(detail(edited, builtIn)), delegatable: true, conductorTools: false, delegateOnly: false, bg: '#f5e6ba' };
    expect(crewSaveBody(d, detail(edited, builtIn)).fields).toEqual({ delegatable: null, mcp: null, delegate_only: null, avatar: { bg: '#f5e6ba' } });
    expect(crewSaveBody({ ...d, icon: '', bg: '' }, detail(edited, builtIn)).fields.avatar).toEqual({ icon: null });
  });

  it('names a cleared icon, shape or color as null, so the server drops it and keeps an uploaded image', () => {
    const builtIn = role();
    const edited = role({ kind: 'edited', avatar: { image: '/api/crew/builder/avatar?v=1', icon: 'icon:zap', shape: 'fan', bg: '#f5e6ba' } });
    const d = crewDraftOf(detail(edited, builtIn));
    expect(d.shape).toBe('fan');
    expect(crewSaveBody({ ...d, bg: '' }, detail(edited, builtIn)).fields.avatar).toEqual({ bg: null });
    expect(crewSaveBody({ ...d, shape: '' }, detail(edited, builtIn)).fields.avatar).toEqual({ shape: null });
    expect(crewSaveBody({ ...d, icon: '', shape: '', bg: '' }, detail(edited, builtIn)).fields.avatar).toEqual({ icon: null, shape: null, bg: null });
    expect(crewSaveBody({ ...d, name: 'Builder 2' }, detail(edited, builtIn)).fields.avatar).toBeUndefined();
  });

  it('saves a crew shape picked with its color, and a shape alone, from the character the id picks', () => {
    const builtIn = role();
    const shipped = detail(builtIn, builtIn);
    expect(crewSaveBody({ ...crewDraftOf(shipped), shape: 'bucket', bg: '#0093e4' }, shipped).fields).toEqual({ avatar: { shape: 'bucket', bg: '#0093e4' } });
    expect(crewSaveBody({ ...crewDraftOf(shipped), shape: 'droplet' }, shipped).fields).toEqual({ avatar: { shape: 'droplet' } });
  });

  it('sends No file edits as tools: full when turned off on a built-in that ships it, and drops the key when back to the default', () => {
    const builtIn = role({ id: 'reviewer', tools: 'no-edits' });
    const shipped = detail(builtIn, builtIn);
    expect(crewDraftOf(shipped).noEdits).toBe(true);
    expect(crewSaveBody({ ...crewDraftOf(shipped), noEdits: false }, shipped).fields).toEqual({ tools: 'full' });
    const edited = role({ id: 'reviewer', kind: 'edited', tools: 'full', charterMode: 'append' });
    expect(crewSaveBody({ ...crewDraftOf(detail(edited, builtIn)), noEdits: true }, detail(edited, builtIn)).fields).toEqual({ tools: '' });
    // A role of the user's own writes the key only while it is on.
    const own = role({ id: 'checker', kind: 'own' });
    expect(crewSaveBody({ ...crewDraftOf(detail(own, null)), noEdits: true }, detail(own, null)).fields).toEqual({ tools: 'no-edits' });
    expect(crewSaveBody({ ...crewDraftOf(detail(role({ ...own, tools: 'no-edits' }), null)), noEdits: false }, detail(role({ ...own, tools: 'no-edits' }), null)).fields).toEqual({ tools: '' });
    // A server from before no-edits sends no tools: the switch reads off.
    expect(crewTools(role())).toBe('full');
    expect(crewTools(role({ delegateOnly: true }))).toBe('delegate-only');
  });

  it('sends the memory settings like the others, and empty when back to the default', () => {
    const own = role({ id: 'checker', kind: 'own' });
    expect(crewDraftOf(detail(own, null))).toMatchObject({ memory: 'read-write', memoryWrites: 'review' });
    expect(crewSaveBody({ ...crewDraftOf(detail(own, null)), memoryWrites: 'auto' }, detail(own, null)).fields).toEqual({ memory_writes: 'auto' });
    expect(crewSaveBody({ ...crewDraftOf(detail(own, null)), memory: 'off' }, detail(own, null)).fields).toEqual({ memory: 'off' });
    const auto = role({ ...own, memoryWrites: 'auto' });
    expect(crewSaveBody({ ...crewDraftOf(detail(auto, null)), memoryWrites: 'review' }, detail(auto, null)).fields).toEqual({ memory_writes: '' });
  });

  it('says on the row how many lessons wait, and where a lesson applies', () => {
    expect(crewChips(role({ memoryWaiting: 2 })).map((c) => [c.label, c.tone])).toEqual([
      ['Built-in', 'outline'],
      ['2 lessons wait', 'needs'],
    ]);
    expect(crewChips(role({ memoryWaiting: 1 })).at(-1)?.label).toBe('1 lesson waits');
    expect(memoryScope({ channel_id: 'acme' })).toBe('#acme only');
    expect(memoryScope({ channel_id: null })).toBe('Every channel');
  });

  it('sends the review switch like the others: true when turned on, null when back to its default', () => {
    const own = role({ kind: 'own' });
    const on = { ...crewDraftOf(detail(own, null)), review: true };
    expect(crewSaveBody(on, detail(own, null)).fields).toEqual({ review: true });
    const reviewer = role({ id: 'reviewer', review: true });
    const off = { ...crewDraftOf(detail(role({ id: 'reviewer', review: true, kind: 'own' }), null)), review: false };
    expect(crewSaveBody(off, detail(role({ id: 'reviewer', review: true, kind: 'own' }), null)).fields).toEqual({ review: null });
    expect(crewDraftOf(detail(reviewer, reviewer)).review).toBe(true);
  });

  it('sends every field for a new role of the user own, and no charter mode', () => {
    const d = { ...blankCrewDraft(), name: 'Store ops', charter: 'Dry run first.' };
    const body = crewSaveBody(d, null);
    expect(body).toEqual({
      fields: { name: 'Store ops', description: '', harness: '', model: 'auto', effort: '', channel: '', delegate_only: null, tools: '', delegatable: null, mcp: [], review: null, memory: '', memory_writes: '' },
      charter: 'Dry run first.',
    });
  });

  it('says why a form cannot be saved', () => {
    expect(crewDraftProblem(blankCrewDraft())).toBe('Give the agent a name.');
    expect(crewDraftProblem({ ...blankCrewDraft(), name: 'X' }, 'Bad Id')).toBe('The id takes lowercase letters, digits and dashes.');
    expect(crewDraftProblem({ ...blankCrewDraft(), name: 'X', delegateOnly: true })).toMatch(/needs the conductor tools/);
    expect(crewDraftProblem({ ...blankCrewDraft(), name: 'X' }, 'x')).toBeNull();
  });

  it('opens the markdown of the file, or a fresh overlay', () => {
    expect(crewMarkdownOf(detail(role(), role()))).toBe('---\ncharter_mode: append\n---\n');
    expect(crewMarkdownOf(detail(role({ kind: 'edited' }), role(), 'Use pnpm.'))).toBe('---\n---\nUse pnpm.\n');
    expect(crewMarkdownOf(null)).toMatch(/^---\nname: /);
  });
});

describe('Compare', () => {
  it('diffs line by line', () => {
    expect(lineDiff('a\nb\nc', 'a\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
    expect(lineDiff('same', 'same')).toEqual([{ kind: 'same', text: 'same' }]);
  });

  it('turns the three ways out of a changed built-in into saves', () => {
    expect(CHANGED_CHARTER_ACTIONS.keep('Mine.')).toEqual({ charter: 'Mine.', charter_mode: 'replace' });
    expect(CHANGED_CHARTER_ACTIONS.takeBuiltIn()).toEqual({ charter: '', charter_mode: 'append' });
    expect(CHANGED_CHARTER_ACTIONS.addMine('Mine.')).toEqual({ charter: 'Mine.', charter_mode: 'append' });
  });
});

describe('remoteRoleNote', () => {
  it('says what a role on a remote harness gives up, naming where it runs', () => {
    expect(remoteRoleNote('custom:hermes-box')).toMatch(/^This agent runs on a server outside Omni, with its own tools and secrets\./);
    expect(remoteRoleNote('custom:hermes-box')).toMatch(/Only routes work, so that is refused/);
    expect(remoteRoleNote('cursor-cloud')).toMatch(/^This agent runs on Cursor Cloud/);
  });
});
