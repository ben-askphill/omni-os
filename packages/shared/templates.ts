// Templates: skills for common jobs (a client question, a meeting agenda, a CRO audit) that the `/` menu and the New
// sheet offer on every harness. The files live in templates/ at the repo root and data/templates/ (apps/server/templates.ts);
// Omni expands `/<template> what you typed` into the template's instructions before the harness sees it.
import { findCommand, parseSlash, type SlashCommand } from './slash.ts';

/** `quick`: a short answer in the thread. `task`: work that writes, runs or browses. */
export type TemplateKind = 'quick' | 'task';

/**
 * `core` ships on. `store` is the Shopify pack: it shows only while the Shopify add-on is on (the `shopify` display
 * switch, Settings > General), the same switch that shows a channel's Store card.
 */
export type TemplatePack = 'core' | 'store';

export const isTemplatePack = (v: unknown): v is TemplatePack => v === 'core' || v === 'store';

export interface Template {
  /** The slash name, from the file name. */
  id: string;
  name: string;
  description: string;
  argumentHint?: string;
  kind: TemplateKind;
  pack: TemplatePack;
  /** A harness skill that does the job better. Used when the thread's harness lists it. */
  skill?: string;
  /** The instructions. `$ARGUMENTS` becomes what was typed after the name. */
  body: string;
}

/** GET /api/templates: the templates the menus offer, and how many Shopify ones wait for the add-on. */
export interface TemplateList {
  templates: Template[];
  /** The Shopify add-on is on, so the `store` templates are in `templates`. */
  shopify: boolean;
  /** Shopify templates left out while the add-on is off. */
  hidden: number;
}

/** The templates a machine offers: every `core` one, and the `store` ones while the Shopify add-on is on. */
export const offeredTemplates = (all: readonly Template[], shopify: boolean): Template[] => all.filter((t) => t.pack === 'core' || shopify);

/** Quick ones first, then by name: the order the chips and Settings show. */
export const sortTemplates = (list: readonly Template[]): Template[] =>
  [...list].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'quick' ? -1 : 1));

/** A template as a `/` menu row. It runs only at the start of a message. */
export const templateCommand = (t: Template): SlashCommand => ({
  name: t.id,
  description: t.description,
  ...(t.argumentHint && { argumentHint: t.argumentHint }),
  source: 'template',
  mentionable: false,
});

/**
 * The menu rows for the templates, after the harness's own list: a harness command with the same name wins, so a
 * template never hides one of the user's own skills.
 */
export function withTemplates(commands: SlashCommand[], templates: Template[]): SlashCommand[] {
  const taken = new Set(commands.flatMap((c) => [c.name, ...(c.aliases ?? [])].map((n) => n.toLowerCase())));
  return [...commands, ...templates.filter((t) => !taken.has(t.id.toLowerCase())).map(templateCommand)];
}

/** The template a message starts with, and what was typed after it, unless the harness has a command by that name. */
export function leadTemplate(
  text: string,
  templates: Template[],
  commands: SlashCommand[],
): { template: Template; args: string; start: number; end: number } | null {
  const { lead } = parseSlash(text);
  if (!lead || findCommand(lead.name, commands)) return null;
  const template = templates.find((t) => t.id.toLowerCase() === lead.name.toLowerCase());
  return template ? { template, args: lead.args, start: lead.start, end: lead.end } : null;
}

/** What a template's job was given when nothing was typed after its name. */
export const NO_ARGUMENTS = '(nothing yet: ask me for it first)';

/**
 * The text the harness gets for a template: its instructions with the typed text in place of `$ARGUMENTS`, started by
 * its skill when the thread's harness lists one by that name. A quick template asks for a direct answer.
 */
export function expandTemplate(t: Template, args: string, commands: SlashCommand[]): string {
  const given = args.trim() || NO_ARGUMENTS;
  const body = t.body.includes('$ARGUMENTS') ? t.body.replaceAll('$ARGUMENTS', given) : `${t.body}\n\nInput: ${given}`;
  const quick = t.kind === 'quick' ? '\n\nThis is a quick ask: answer here yourself, in one reply, without starting other threads or changing files.' : '';
  const text = `Template: ${t.name}\n\n${body}${quick}`;
  const skill = t.skill ? findCommand(t.skill, commands) : undefined;
  return skill ? `/${skill.name} ${text}` : text;
}

/** What picking a template in the New sheet puts in the box: its name and a space, ready for the input. */
export const templateDraft = (t: Template) => `/${t.id} `;
