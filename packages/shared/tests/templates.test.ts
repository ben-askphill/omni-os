import { describe, expect, it } from 'vitest';
import type { SlashCommand } from '../slash.ts';
import { expandTemplate, leadTemplate, NO_ARGUMENTS, offeredTemplates, sortTemplates, templateDraft, withTemplates, type Template } from '../templates.ts';

const tpl = (over: Partial<Template> = {}): Template => ({
  id: 'client-qa',
  name: 'Client question',
  description: 'Answer a client question with sources',
  argumentHint: '<the question>',
  kind: 'quick',
  pack: 'core',
  body: 'Answer this: $ARGUMENTS',
  ...over,
});
const cmd = (name: string, over: Partial<SlashCommand> = {}): SlashCommand => ({ name, description: '', source: 'personal', mentionable: true, ...over });

describe('withTemplates', () => {
  it('lists the templates after the harness commands, as template rows that run only at the start', () => {
    const rows = withTemplates([cmd('tdd')], [tpl()]);
    expect(rows.map((r) => r.name)).toEqual(['tdd', 'client-qa']);
    expect(rows[1]).toEqual({ name: 'client-qa', description: 'Answer a client question with sources', argumentHint: '<the question>', source: 'template', mentionable: false });
  });

  it('leaves a template out when the harness has a command or alias by its name', () => {
    expect(withTemplates([cmd('Client-QA')], [tpl()]).map((r) => r.source)).toEqual(['personal']);
    expect(withTemplates([cmd('qa', { aliases: ['client-qa'] })], [tpl()])).toHaveLength(1);
  });
});

describe('leadTemplate', () => {
  it('finds the template a message starts with and what follows it', () => {
    expect(leadTemplate('/client-qa where is my order?', [tpl()], [])).toMatchObject({ template: { id: 'client-qa' }, args: 'where is my order?', start: 0, end: 10 });
  });

  it('is null for a harness command by that name, a template further in, or plain text', () => {
    expect(leadTemplate('/client-qa x', [tpl()], [cmd('client-qa')])).toBeNull();
    expect(leadTemplate('please /client-qa x', [tpl()], [])).toBeNull();
    expect(leadTemplate('where is my order?', [tpl()], [])).toBeNull();
    expect(leadTemplate('/nope x', [tpl()], [])).toBeNull();
  });
});

describe('expandTemplate', () => {
  it('puts the input where $ARGUMENTS was and asks a quick one to answer in one reply', () => {
    const text = expandTemplate(tpl(), ' where is my order? ', []);
    expect(text.startsWith('Template: Client question\n\nAnswer this: where is my order?')).toBe(true);
    expect(text).toContain('This is a quick ask');
  });

  it('asks for the input when nothing was typed, and adds it at the end when the body has no $ARGUMENTS', () => {
    expect(expandTemplate(tpl(), '', [])).toContain(`Answer this: ${NO_ARGUMENTS}`);
    expect(expandTemplate(tpl({ body: 'Plan the meeting.', kind: 'task' }), 'Q4 review', [])).toBe('Template: Client question\n\nPlan the meeting.\n\nInput: Q4 review');
  });

  it('starts with the skill when the harness lists it, and goes without it when not', () => {
    const t = tpl({ kind: 'task', skill: 'ecomm-cro-expert' });
    expect(expandTemplate(t, 'shop.example', [cmd('ecomm-cro-expert')]).startsWith('/ecomm-cro-expert Template: Client question')).toBe(true);
    expect(expandTemplate(t, 'shop.example', []).startsWith('Template: ')).toBe(true);
  });
});

describe('offeredTemplates and sortTemplates', () => {
  const store = tpl({ id: 'cro-audit', name: 'CRO audit', kind: 'task', pack: 'store' });
  const agenda = tpl({ id: 'meeting-agenda', name: 'Agenda', kind: 'task' });

  it('offers the Shopify pack only while the add-on is on', () => {
    expect(offeredTemplates([tpl(), store], false).map((t) => t.id)).toEqual(['client-qa']);
    expect(offeredTemplates([tpl(), store], true).map((t) => t.id)).toEqual(['client-qa', 'cro-audit']);
  });

  it('puts quick ones first, then by name', () => {
    expect(sortTemplates([store, agenda, tpl()]).map((t) => t.id)).toEqual(['client-qa', 'meeting-agenda', 'cro-audit']);
  });

  it('drafts the name and a space for the input', () => {
    expect(templateDraft(tpl())).toBe('/client-qa ');
  });
});
