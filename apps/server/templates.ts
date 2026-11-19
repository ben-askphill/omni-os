// Templates on this machine: the shipped files in templates/ and the user's own in data/templates/ (same name wins).
// Read from disk at each call, so an edited file shows at once. The Shopify ones show only while the Shopify add-on is
// on (display.ts displayPrefs, the same switch the Store card and the prompt read). See packages/shared/templates.ts.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isCommandName } from '@omni/shared/slash.ts';
import { isTemplatePack, offeredTemplates, type Template, type TemplateList } from '@omni/shared/templates.ts';
import { paths } from './config.ts';
import { splitCrewFile } from './crew.ts';
import { displayPrefs } from './display.ts';

/** A template file, or null when it is not one (a README, a bad name, no body). */
export function parseTemplate(id: string, src: string): Template | null {
  if (!isCommandName(id)) return null;
  const { meta, body } = splitCrewFile(src);
  if (!body) return null;
  const text = (k: string) => (typeof meta[k] === 'string' && (meta[k] as string).trim() ? (meta[k] as string).trim() : undefined);
  return {
    id,
    name: text('name') ?? id,
    description: text('description') ?? '',
    ...(text('argument-hint') && { argumentHint: text('argument-hint') }),
    kind: meta.kind === 'task' ? 'task' : 'quick',
    pack: isTemplatePack(meta.pack) ? meta.pack : 'core',
    ...(text('skill') && { skill: text('skill') }),
    body,
  };
}

function readDir(dir: string): Map<string, Template> {
  const out = new Map<string, Template>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.md') || f.toLowerCase() === 'readme.md') continue;
    const id = basename(f, '.md');
    try {
      const t = parseTemplate(id, readFileSync(join(dir, f), 'utf8'));
      if (t) out.set(id, t);
    } catch {
      // A file that can't be read is left out; the rest still show.
    }
  }
  return out;
}

/** Every template on this machine, packs that are off included. */
export function allTemplates(): Template[] {
  const merged = new Map([...readDir(paths.templates), ...readDir(paths.personalTemplates)]);
  return [...merged.values()];
}

/** The templates the menus offer. */
export const listTemplates = (): Template[] => offeredTemplates(allTemplates(), displayPrefs().shopify);

export function templateList(): TemplateList {
  const all = allTemplates();
  const { shopify } = displayPrefs();
  const templates = offeredTemplates(all, shopify);
  return { templates, shopify, hidden: all.length - templates.length };
}
