// Writing crew roles from the clients. Every change lands in the user's file in data/crew/: a role of their own, or
// an overlay on a built-in from crew/, which no client ever writes. A release replaces crew/ and never an overlay, and
// an overlay that adds to the built-in charter keeps the release's fixes (crew.ts). Hiding a built-in is a per-machine
// flag in data/omni.config.json, as deleting a shipped automation is.
//
// The store keeps frontmatter keys it does not know, so a key a later build writes (a `runtime:` binding for an
// outside agent, say) survives an edit from this one. `harness` is checked against this machine's harness catalog,
// never against a fixed list of ids.

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML, { Document, isMap } from 'yaml';
import { z } from 'zod';
import { paths } from './config.ts';
import { charterHash, crewFiles, UNHIDEABLE, crewTexts, getCrew, mergeCrew, parseCrewFile, splitCrewFile, type CrewRole } from './crew.ts';
import { validateRun, type Catalog } from './harness/catalog.ts';
import { asksAuto } from './harness/auto.ts';
import { validateDefaults } from './harness/resolve.ts';
import { updateUserConfig } from './user-config.ts';

const refused = (message: string, status: 400 | 404 | 409 = 400) => Object.assign(new Error(message), { status });

/** A role's id, and its file's name in data/crew/: lowercase words and dashes, like an automation's. Never changes. */
export const CREW_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Built-ins Omni itself relies on. Only ever an overlay on the shipped file: no role of the user's own takes the id. */
export const RESERVED_CREW = ['conductor', 'reviewer', 'usage-scan'] as const;


/** The routers. A save that gives one working tools, or takes its omni tools away, is refused. */
const ROUTERS = new Set(['conductor', 'usage-scan']);

/** Omni's own MCP servers a role can name. More come with the MCP registry (plan slice S5). */
const OMNI_MCP = new Set(['omni']);

const optText = (max: number) => z.string().trim().max(max).optional();

/** What a client sets, by frontmatter key. An empty string removes the key: an overlay then falls back to the built-in. */
export const crewFields = z
  .object({
    name: optText(80),
    description: optText(500),
    harness: optText(80),
    model: optText(120),
    effort: optText(40),
    channel: optText(100),
    mcp: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    delegate_only: z.boolean().optional(),
    delegatable: z.boolean().optional(),
  })
  .strict();
export type CrewFields = z.infer<typeof crewFields>;

/**
 * A save: either the fields and charter to change in the file, or the whole file as markdown. For a built-in, the
 * charter is the overlay's body: what is added to the shipped charter, or the whole charter with `replace`.
 */
export const crewSave = z.union([
  z.object({ markdown: z.string().max(200_000) }).strict(),
  z
    .object({
      fields: crewFields.optional(),
      charter: z.string().max(100_000).optional(),
      charter_mode: z.enum(['append', 'replace']).optional(),
    })
    .strict(),
]);
export type CrewSave = z.infer<typeof crewSave>;

export interface CrewDetail {
  role: CrewRole;
  /** The shipped file, or null for a role of the user's own. */
  shipped: string | null;
  /** The user's file: their role, or their overlay on the built-in. Null for an unedited built-in. */
  own: string | null;
  /** The shipped charter's hash, which a replacing overlay records as `based_on`. */
  shippedHash: string | null;
}

export function crewDetail(id: string): CrewDetail | null {
  const role = getCrew(id);
  if (!role) return null;
  const { shipped, own } = crewTexts(id);
  return { role, shipped, own, shippedHash: shipped === null ? null : charterHash(splitCrewFile(shipped).body) };
}

const ownFile = (id: string) => join(paths.personalCrew, `${id}.md`);

function writeOwn(id: string, text: string) {
  mkdirSync(paths.personalCrew, { recursive: true });
  const tmp = join(paths.personalCrew, `.${id}.md.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, ownFile(id));
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** The user's file as a YAML document and a body, so a save changes only the keys it names. */
function openOwn(text: string | null): { doc: Document; body: string } {
  const m = text?.match(FRONTMATTER);
  const doc = m?.[1].trim() ? YAML.parseDocument(m[1]) : new Document({});
  if (doc.errors.length) throw refused(`The file's frontmatter is not valid YAML: ${doc.errors[0].message}. Fix it in the markdown first.`);
  if (!isMap(doc.contents)) throw refused('The frontmatter must be a list of keys. Fix it in the markdown first.');
  return { doc, body: m ? m[2].trim() : (text ?? '').trim() };
}

const serialize = (doc: Document, body: string) => {
  const yaml = isMap(doc.contents) && doc.contents.items.length ? doc.toString({ lineWidth: 0 }) : '';
  return `---\n${yaml}---\n${body ? `${body}\n` : ''}`;
};

/**
 * Why these run defaults are unusable on this machine, or undefined. The harness is whatever this machine's catalog
 * has, looked up by id, never a fixed list: a runtime added to the catalog later is a valid binding as it is.
 */
export function crewRunProblem(role: Pick<CrewRole, 'harness' | 'model' | 'effort'>, cat: Catalog): string | undefined {
  const defaults = { harness: role.harness, model: role.model, effort: role.effort };
  if (!role.harness || asksAuto(defaults)) return validateDefaults(defaults, cat);
  const h = cat.harnesses.find((x) => x.id === role.harness);
  if (!h) return `unknown harness "${role.harness}" (this machine has: ${cat.harnesses.map((x) => x.id).join(', ')})`;
  if (!h.models.length || !(role.model || role.effort)) return undefined; // nothing to check the model against
  const check = validateRun(cat, h.id, role.model || h.models.find((m) => m.default)?.id || h.models[0].id, role.effort ?? '');
  return check.ok ? undefined : check.error;
}

export interface CrewSaveContext {
  catalog: Catalog;
  /** Whether a channel with this id exists, for the role's default channel. */
  channelExists: (id: string) => boolean;
}

/** Check the role a write would leave behind. Throws a refusal with the first problem. */
function check(id: string, role: CrewRole, ctx: CrewSaveContext) {
  if (role.error) throw refused(role.error.replace(/^bad frontmatter/, 'The frontmatter is not valid YAML'));
  const run = crewRunProblem(role, ctx.catalog);
  if (run) throw refused(`Run defaults: ${run}.`);
  if (role.channel && !ctx.channelExists(role.channel)) throw refused(`No channel "${role.channel}" for the role's default channel.`);
  const unknown = role.mcp.filter((s) => !OMNI_MCP.has(s));
  if (unknown.length) throw refused(`Unknown MCP server ${unknown.map((s) => `"${s}"`).join(', ')}. A role can name: ${[...OMNI_MCP].join(', ')}.`);
  if (ROUTERS.has(id) && (!role.delegateOnly || !role.mcp.includes('omni'))) {
    throw refused(`${role.name} only routes work: it keeps delegate_only and the omni MCP server.`, 409);
  }
}

/**
 * Save a role: create one of the user's own (`create`), edit theirs, or write an overlay on a built-in. A new overlay
 * adds to the shipped charter unless the save says `replace`. A save that sets the charter or its mode records the
 * shipped charter it was written against (`based_on`), which is how a replacing overlay notices a release changed it.
 */
export function saveCrew(id: string, save: CrewSave, ctx: CrewSaveContext, opts: { create?: boolean } = {}): CrewDetail {
  if (!CREW_ID.test(id)) throw refused('A role id is lowercase letters, digits and dashes, up to 64 characters.');
  const { shipped, own } = crewTexts(id);
  if (opts.create) {
    if (shipped !== null || own !== null) throw refused(`A role "${id}" already exists.`, 409);
    if ((RESERVED_CREW as readonly string[]).includes(id)) throw refused(`"${id}" is a built-in role's id.`, 409);
  } else if (shipped === null && own === null) {
    throw refused(`No crew role "${id}".`, 404);
  }

  let text: string;
  if ('markdown' in save) {
    text = save.markdown;
    if (shipped !== null) {
      // A hand-written overlay still records what it was written against, unless it says so itself.
      const { doc, body } = openOwn(text);
      if (!doc.has('based_on') && (own === null || splitCrewFile(own).body !== body)) doc.set('based_on', charterHash(splitCrewFile(shipped).body));
      text = serialize(doc, body);
    }
  } else {
    const { doc, body: oldBody } = openOwn(own);
    for (const [key, value] of Object.entries(save.fields ?? {})) {
      if (value === undefined) continue;
      if (value === '' || (Array.isArray(value) && !value.length && shipped === null)) doc.delete(key);
      else doc.set(key, value);
    }
    if (shipped !== null) {
      if (save.charter_mode) doc.set('charter_mode', save.charter_mode);
      else if (own === null) doc.set('charter_mode', 'append');
      if (own === null || save.charter !== undefined || save.charter_mode) doc.set('based_on', charterHash(splitCrewFile(shipped).body));
    } else if (save.charter_mode) {
      throw refused('Only an edit of a built-in role adds to or replaces its charter.');
    }
    text = serialize(doc, save.charter === undefined ? oldBody : save.charter.trim());
  }

  const role = shipped !== null ? mergeCrew(id, splitCrewFile(shipped), splitCrewFile(text)) : parseCrewFile(id, text);
  if (shipped === null && !splitCrewFile(text).meta.name) throw refused('Give the role a name.');
  check(id, role, ctx);
  writeOwn(id, text);
  return crewDetail(id)!;
}

/** Delete a role of the user's own. A built-in is hidden or reset instead. */
export function deleteCrew(id: string) {
  const { shipped, own } = crewTexts(id);
  if (shipped !== null) throw refused('A built-in role cannot be deleted. Hide it, or reset your edit.', 409);
  if (own === null) throw refused(`No crew role "${id}".`, 404);
  removeOwn(id);
}

/** Drop the user's overlay on a built-in, so the shipped role loads as it is. */
export function resetCrew(id: string): CrewDetail {
  const { shipped, own } = crewTexts(id);
  if (shipped === null || own === null) throw refused('Only an edited built-in role can be reset.', 409);
  removeOwn(id);
  return crewDetail(id)!;
}

function removeOwn(id: string) {
  const file = crewFiles(paths.personalCrew).get(id);
  if (file) rmSync(file);
}

/** Hide a built-in on this machine, or show it again. */
export function setCrewHidden(id: string, hidden: boolean): CrewDetail {
  const { shipped, own } = crewTexts(id);
  if (shipped === null) throw refused(own === null ? `No crew role "${id}".` : 'Only a built-in role is hidden. Delete a role of your own instead.', own === null ? 404 : 409);
  if (hidden && UNHIDEABLE.has(id)) throw refused(`${getCrew(id)?.name ?? id} cannot be hidden: Omni relies on it.`, 409);
  updateUserConfig({ crew: { [id]: hidden ? { hidden: true } : null } });
  return crewDetail(id)!;
}
