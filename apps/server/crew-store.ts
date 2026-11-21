// Writing crew roles from the clients. Every change lands in the user's file in data/crew/: a role of their own, or
// an overlay on a built-in from crew/, which no client ever writes. A release replaces crew/ and never an overlay, and
// an overlay that adds to the built-in charter keeps the release's fixes (crew.ts). Hiding a built-in is a per-machine
// flag in data/omni.config.json, as deleting a shipped automation is.
//
// The store keeps frontmatter keys it does not know, so a key a later build writes (a `runtime:` binding for an
// outside agent, say) survives an edit from this one. `harness` is checked against this machine's harness catalog,
// never against a fixed list of ids.

import { createHash } from 'node:crypto';
import YAML, { Document, isMap } from 'yaml';
import { z } from 'zod';
import { publishFeed } from './bus.ts';
import { parseChannelIcon, SVG_MAX, SVG_PREFIX } from '@omni/shared/channel-icon.ts';
import { CREW_SHAPE_IDS } from '@omni/shared/crew-shapes.ts';
import { parseAvatarImage } from './agent-avatar.ts';
import { charterHash, CREW_ID, CREW_LOCKS, CREW_TOOLS, crewTexts, getCrew, isCrewShape, listCrew, LOCKED_VALUE, lockedOverlay, mergeCrew, mergeSources, parseCrewFile, remoteDelegateOnlyRefusal, removeOwnCrew, splitCrewFile, writeOwnCrew, type CrewRole } from './crew.ts';
import type { CrewLockedField } from '@omni/shared/crew-settings.ts';
import { ROLE_MEMORY_MODES } from '@omni/shared/memory.ts';
import { record } from './db/sync.ts';
import { validateRun, type Catalog } from './harness/catalog.ts';
import { asksAuto } from './harness/auto.ts';
import { validateDefaults } from './harness/resolve.ts';
import { capabilitiesOf, providerWhere } from './harness/registry.ts';
import { updateUserConfig } from './user-config.ts';
import { isRemoteAgentHarness } from '@omni/shared/remote-agent.ts';

const refused = (message: string, status: 400 | 404 | 409 = 400) => Object.assign(new Error(message), { status });

export { CREW_ID };

/** Built-ins Omni itself relies on (crew.ts CREW_LOCKS). Only ever an overlay on the shipped file: no role of the user's own takes the id. */
export const RESERVED_CREW = Object.keys(CREW_LOCKS);

/** Omni's own MCP servers a role can name. More come with the MCP registry (plan slice S5). */
const OMNI_MCP = new Set(['omni']);

const optText = (max: number) => z.string().trim().max(max).optional();

/**
 * A role's avatar: an uploaded image (agent-avatar.ts), a shared icon (`icon:<name>`), one emoji or an SVG icon
 * (`svg:<markup>`, checked as a channel's), a crew shape (one of CREW_SHAPE_IDS, ADR 0021) and a hex background, the
 * agent's one color. A save changes the keys it names and keeps the rest; null or an empty string removes one.
 * `avatar: null` removes the icon, shape and background, as it did before uploads: the image goes only when a save names it.
 */
const avatar = z
  .object({
    image: z
      .string()
      .max(500_000)
      .superRefine((v, ctx) => {
        if (!v) return;
        const parsed = parseAvatarImage(v);
        if ('problem' in parsed) ctx.addIssue({ code: 'custom', message: parsed.problem });
      })
      .nullable()
      .optional(),
    icon: z
      .string()
      .max(SVG_PREFIX.length + SVG_MAX)
      .refine((v) => !v || !!parseChannelIcon(v), 'An avatar icon is one of the shared icons, one emoji or a plain SVG.')
      .nullable()
      .optional(),
    shape: z
      .string()
      .refine((v) => !v || isCrewShape(v), `An avatar shape is one of ${CREW_SHAPE_IDS.join(', ')}.`)
      .nullable()
      .optional(),
    bg: z.string().regex(/^$|^#[0-9a-f]{6}$/i, 'An avatar background is a hex color like #f5e6ba.').nullable().optional(),
  })
  .strict()
  .nullable()
  .optional();
type AvatarSave = z.infer<typeof avatar>;

/** What a client sets, by frontmatter key. An empty string or null removes the key: an overlay then falls back to the built-in. */
export const crewFields = z
  .object({
    name: optText(80),
    description: optText(500),
    avatar,
    harness: optText(80),
    model: optText(120),
    effort: optText(40),
    channel: optText(100),
    mcp: z.array(z.string().trim().min(1).max(80)).max(20).nullable().optional(),
    delegate_only: z.boolean().nullable().optional(),
    /** full, no-edits or delegate-only. Empty or null removes the key. */
    tools: z
      .union([z.enum(CREW_TOOLS as [string, ...string[]]), z.literal('')])
      .nullable()
      .optional(),
    delegatable: z.boolean().nullable().optional(),
    review: z.boolean().nullable().optional(),
    /** off, read or read-write: whether its threads read its lessons and propose new ones. Empty or null removes the key. */
    memory: z
      .union([z.enum(ROLE_MEMORY_MODES as [string, ...string[]]), z.literal('')])
      .nullable()
      .optional(),
    /** review or auto: whether a lesson its threads propose waits for the user. Empty or null removes the key. */
    memory_writes: z.union([z.enum(['review', 'auto']), z.literal('')]).nullable().optional(),
  })
  .strict();
export type CrewFields = z.infer<typeof crewFields>;

/** The longest crew file a save takes: a charter and an uploaded avatar. */
export const MARKDOWN_MAX = 600_000;

/**
 * A save: either the fields and charter to change in the file, or the whole file as markdown. For a built-in, the
 * charter is the overlay's body: what is added to the shipped charter, or the whole charter with `replace`.
 */
export const crewSave = z.union([
  // An uploaded avatar rides in the frontmatter (agent-avatar.ts), so a file can be a few hundred KB.
  z.object({ markdown: z.string().max(MARKDOWN_MAX) }).strict(),
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
  /** The shipped role without the user's overlay: what a field set back to it falls back to. Null for a role of their own. */
  builtIn: CrewRole | null;
  /** The shipped file, or null for a role of the user's own. */
  shipped: string | null;
  /** The user's file: their role, or their overlay on the built-in. Null for an unedited built-in. */
  own: string | null;
  /** The shipped charter's hash, which a replacing overlay records as `based_on`. */
  shippedHash: string | null;
  /** The charters as written, placeholders kept: the built-in's, the user's file's body, and the one the role runs with. */
  charters: { builtIn: string | null; own: string | null; effective: string };
}

export function crewDetail(id: string): CrewDetail | null {
  const role = getCrew(id);
  if (!role) return null;
  const { shipped, own } = crewTexts(id);
  return detailOf(role, shipped, own);
}

function detailOf(role: CrewRole, shipped: string | null, own: string | null): CrewDetail {
  const id = role.id;
  const base = shipped === null ? null : splitCrewFile(shipped);
  const mine = own === null ? null : splitCrewFile(own);
  return {
    role,
    builtIn: shipped === null ? null : { ...parseCrewFile(id, shipped), kind: 'shipped', hidden: role.hidden },
    shipped,
    own,
    shippedHash: base ? charterHash(base.body) : null,
    charters: {
      builtIn: base?.body ?? null,
      own: mine?.body ?? null,
      effective: base && mine ? mergeSources(base, lockedOverlay(id, base, mine)).body : (base ?? mine)!.body,
    },
  };
}

/** Write the user's file and send it to the other machines (sync/handlers/crew-file.ts). */
function writeOwn(id: string, text: string) {
  writeOwnCrew(id, text);
  record('crew_file', id);
  publishFeed({ type: 'crew' });
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

/** A name as names compare: trimmed, case and spacing aside. */
const sameName = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** Check the role a write would leave behind, against the built-in it overlays (null for a role of the user's own). Throws a refusal with the first problem. */
function check(id: string, role: CrewRole, builtIn: CrewRole | null, ctx: CrewSaveContext) {
  if (role.error) throw refused(role.error.replace(/^bad frontmatter/, 'The frontmatter is not valid YAML'));
  // A transcript names each reply's agent, so two agents both shown as Builder would read the same (Q4).
  const name = sameName(role.name);
  const twin = listCrew().find((r) => r.id !== id && sameName(r.name) === name);
  if (twin) throw refused(`An agent is already called "${twin.name}". Agent names are unique, ignoring case: pick another.`, 409);
  const run = crewRunProblem(role, ctx.catalog);
  if (run) throw refused(`Run defaults: ${run}.`);
  if (role.channel && !ctx.channelExists(role.channel)) throw refused(`No channel "${role.channel}" for the agent's default channel.`);
  const unknown = role.mcp.filter((s) => !OMNI_MCP.has(s));
  if (unknown.length) throw refused(`Unknown MCP server ${unknown.map((s) => `"${s}"`).join(', ')}. An agent can name: ${[...OMNI_MCP].join(', ')}.`);
  for (const [key, why] of Object.entries(CREW_LOCKS[id]?.fields ?? {}) as [CrewLockedField, string][]) {
    if (!builtIn || LOCKED_VALUE[key](role) === LOCKED_VALUE[key](builtIn)) continue;
    throw refused(key === 'charter_mode' ? `${why} Save your text as an addition (charter_mode: append).` : `${why} Leave ${key} as the built-in has it.`, 409);
  }
  // It would never start: a remote runtime gets no delegate tools and keeps its own work tools (runner/api.ts).
  if (role.delegateOnly && role.harness && !asksAuto(role) && !capabilitiesOf(role.harness)?.toolLimits) throw refused(remoteDelegateOnlyRefusal(role.name, providerWhere(role.harness)), 409);
}

/**
 * Save a role: create one of the user's own (`create`), edit theirs, or write an overlay on a built-in. A new overlay
 * adds to the shipped charter unless the save says `replace`. A save that sets the charter or its mode records the
 * shipped charter it was written against (`based_on`), which is how a replacing overlay notices a release changed it.
 */
export function saveCrew(id: string, save: CrewSave, ctx: CrewSaveContext, opts: { create?: boolean; server?: boolean } = {}): CrewDetail {
  if (!CREW_ID.test(id)) throw refused('An agent id is lowercase letters, digits and dashes, up to 64 characters.');
  const { shipped, own } = crewTexts(id);
  if (opts.create) {
    if (shipped !== null || own !== null) throw refused(`An agent "${id}" already exists.`, 409);
    if (RESERVED_CREW.includes(id)) throw refused(`"${id}" is a built-in agent's id.`, 409);
  } else if (shipped === null && own === null) {
    throw refused(`No agent "${id}".`, 404);
  }

  const text = savedText(save, shipped, own);
  const role = roleIn(id, shipped, text);
  if (shipped === null && !splitCrewFile(text).meta.name) throw refused('Give the agent a name.');
  check(id, role, shipped === null ? null : parseCrewFile(id, shipped), ctx);
  const server = serverRefusal(role, getCrew(id), opts.server);
  if (server) throw refused(server);
  writeOwn(id, text);
  return crewDetail(id)!;
}

/**
 * Why a save cannot bind or unbind a remote agent's server (ADR 0020), or null. A remote agent's server is set when the
 * agent is made (by connecting it, or a new file that names it), so no save points a local agent at one or moves a
 * remote agent off its own, and the pickers that would offer it list local harnesses only.
 */
function serverRefusal(role: CrewRole, before: CrewRole | undefined, connecting = false): string | null {
  // A new agent's file may name a server another agent runs on: it is a remote agent of its own on that server.
  if (connecting || !before || role.harness === before.harness) return null;
  if (isRemoteAgentHarness(role.harness))
    return `${role.name} is a local agent, and a local agent does not run on a remote agent's server. Add the server as its own agent with Add remote agent in Settings > Agents, and seat it in a thread beside ${role.name}.`;
  if (isRemoteAgentHarness(before?.harness)) return `${role.name} is a remote agent: it runs on its own server. Remove it and add it again to point it at another server.`;
  return null;
}

/** The user's file a save leaves: `own` with the save's keys and charter, or the save's markdown as written. */
function savedText(save: CrewSave, shipped: string | null, own: string | null): string {
  if ('markdown' in save) {
    if (shipped === null) return save.markdown;
    // A hand-written overlay still records what it was written against, unless it says so itself.
    const { doc, body } = openOwn(save.markdown);
    if (!doc.has('based_on') && (own === null || splitCrewFile(own).body !== body)) doc.set('based_on', charterHash(splitCrewFile(shipped).body));
    return serialize(doc, body);
  }
  const { doc, body: oldBody } = openOwn(own);
  for (const [key, value] of Object.entries(save.fields ?? {})) {
    if (value === undefined) continue;
    if (key === 'avatar') {
      setAvatar(doc, value as AvatarSave);
      continue;
    }
    if (value === '' || value === null || (Array.isArray(value) && !value.length && shipped === null)) doc.delete(key);
    else doc.set(key, value);
  }
  if (shipped !== null) {
    if (save.charter_mode) doc.set('charter_mode', save.charter_mode);
    else if (own === null) doc.set('charter_mode', 'append');
    if (own === null || save.charter !== undefined || save.charter_mode) doc.set('based_on', charterHash(splitCrewFile(shipped).body));
  } else if (save.charter_mode) {
    throw refused('Only an edit of a built-in agent adds to or replaces its charter.');
  }
  return serialize(doc, save.charter === undefined ? oldBody : save.charter.trim());
}

/**
 * Lay an avatar save over the file's `avatar:` map: the keys it names change, the rest stay (an icon picked in the form
 * keeps the uploaded image). An overlay's map is the user's only, so a key it drops falls back to the built-in's.
 */
function setAvatar(doc: Document, save: AvatarSave) {
  const before = doc.get('avatar');
  const now: Record<string, unknown> = isMap(before) ? { ...(before.toJSON() as Record<string, unknown>) } : {};
  const changes = save === null ? { icon: null, shape: null, bg: null } : (save ?? {});
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) continue;
    if (v === null || v === '') delete now[k];
    else now[k] = v;
  }
  if (Object.keys(now).length) doc.set('avatar', now);
  else doc.delete('avatar');
}

const roleIn = (id: string, shipped: string | null, text: string): CrewRole =>
  shipped !== null ? mergeCrew(id, splitCrewFile(shipped), splitCrewFile(text)) : parseCrewFile(id, text);

/**
 * What a save would write and the role it would make, without writing or checking it: how Settings turns its Form
 * into the Markdown tab and back. `own` stands in for the user's file (the Markdown tab's text), so keys the form does
 * not show stay. `id` names the role being edited; a new role has none.
 */
export function draftCrew(id: string | undefined, save: CrewSave, own?: string | null): { markdown: string; detail: CrewDetail } {
  const texts = id ? crewTexts(id) : { shipped: null, own: null };
  if (id && texts.shipped === null && texts.own === null) throw refused(`No agent "${id}".`, 404);
  const markdown = savedText(save, texts.shipped, own === undefined ? texts.own : own);
  const role = { ...roleIn(id ?? 'new-role', texts.shipped, markdown), hidden: (id && getCrew(id)?.hidden) || false };
  // A form read from a file that does not parse would come out blank, and a save from it would empty the role.
  if (role.error) throw refused(role.error.replace(/^bad frontmatter/, 'The frontmatter is not valid YAML'));
  return { markdown, detail: detailOf(role, texts.shipped, markdown) };
}

/** Set or remove a role's uploaded image (`null`), keeping its icon and background: a photo saved from Settings' Identity block. */
export const saveCrewAvatar = (id: string, image: string | null, ctx: CrewSaveContext): CrewDetail => saveCrew(id, { fields: { avatar: { image } } }, ctx);

/** What `avatar_offered:` records of an image: enough to tell the offered one from one Ben set. */
const imageMark = (image: string) => createHash('sha256').update(image).digest('hex').slice(0, 12);

/** The agent's image is the one its server offered, not one Ben uploaded since: the Identity block says so. */
export function avatarOffered(role: Pick<CrewRole, 'id' | 'avatar'>): boolean {
  const image = role.avatar?.image;
  if (!image) return false;
  const own = crewTexts(role.id).own;
  const mark = own === null ? null : splitCrewFile(own).meta.avatar_offered;
  return typeof mark === 'string' && mark === imageMark(image);
}

/**
 * Put the avatar a remote agent's server offers on it (ADR 0020, Q29), and record in `avatar_offered:` that it was
 * offered. With `unlessOwn`, an avatar Ben set stays: an upload of his, or an icon, shape (ADR 0021) or color he
 * picked. A later offer replaces only an offered one. Null when nothing changed.
 */
export function saveOfferedAvatar(id: string, image: string, ctx: CrewSaveContext, opts: { unlessOwn?: boolean } = {}): CrewDetail | null {
  const role = getCrew(id);
  if (!role) throw refused(`No agent "${id}".`, 404);
  const { own } = crewTexts(id);
  const meta = own === null ? {} : splitCrewFile(own).meta;
  const offered = typeof meta.avatar_offered === 'string' ? meta.avatar_offered : null;
  const mark = imageMark(image);
  if (opts.unlessOwn) {
    const now = role.avatar;
    const bens = !!now && !(now.image && imageMark(now.image) === offered && !now.icon && !now.shape);
    if (bens || offered === mark) return null;
  }
  const { doc, body } = openOwn(own);
  setAvatar(doc, { image });
  doc.set('avatar_offered', mark);
  void ctx;
  writeOwn(id, serialize(doc, body));
  return crewDetail(id);
}

/** What a duplicate never copies: how an overlay joins the built-in, which a whole role of its own has no use for. */
const OVERLAY_KEYS = ['charter_mode', 'based_on'];

/**
 * A new role of the user's own, `to`, with everything `from` has now: its fields, unknown keys included, and its whole
 * charter as written (placeholders kept), so a copy of a built-in no longer follows the built-in.
 */
export function duplicateCrew(from: string, to: string, name: string | undefined, ctx: CrewSaveContext): CrewDetail {
  const { shipped, own } = crewTexts(from);
  if (shipped === null && own === null) throw refused(`No agent "${from}".`, 404);
  const locked = shipped !== null && CREW_LOCKS[from]?.actions?.duplicate;
  if (locked) throw refused(locked, 409);
  const source =
    shipped !== null && own !== null ? mergeSources(splitCrewFile(shipped), lockedOverlay(from, splitCrewFile(shipped), splitCrewFile(own))) : splitCrewFile((shipped ?? own)!);
  const doc = new Document(Object.fromEntries(Object.entries(source.meta).filter(([k, v]) => !OVERLAY_KEYS.includes(k) && v !== undefined && v !== null)));
  doc.set('name', name?.trim() || `${text(source.meta.name) ?? from} copy`);
  return saveCrew(to, { markdown: serialize(doc, source.body) }, ctx, { create: true });
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Delete a role of the user's own. A built-in is hidden or reset instead. */
export function deleteCrew(id: string) {
  const { shipped, own } = crewTexts(id);
  if (shipped !== null) throw refused('A built-in agent cannot be deleted. Hide it, or reset your edit.', 409);
  if (own === null) throw refused(`No agent "${id}".`, 404);
  removeOwn(id);
}

/** Drop the user's overlay on a built-in, so the shipped role loads as it is. */
export function resetCrew(id: string): CrewDetail {
  const { shipped, own } = crewTexts(id);
  if (shipped === null || own === null) throw refused('Only an edited built-in agent can be reset.', 409);
  removeOwn(id);
  return crewDetail(id)!;
}

/** Remove the user's file, here and on the other machines. */
function removeOwn(id: string) {
  if (!removeOwnCrew(id)) return;
  record('crew_file', id, 'delete');
  publishFeed({ type: 'crew' });
}

/** Hide a built-in on this machine, or show it again. */
export function setCrewHidden(id: string, hidden: boolean): CrewDetail {
  const { shipped, own } = crewTexts(id);
  if (shipped === null) throw refused(own === null ? `No agent "${id}".` : 'Only a built-in agent is hidden. Delete an agent of your own instead.', own === null ? 404 : 409);
  const locked = CREW_LOCKS[id]?.actions?.hide;
  if (hidden && locked) throw refused(locked, 409);
  updateUserConfig({ crew: { [id]: hidden ? { hidden: true } : null } });
  publishFeed({ type: 'crew' });
  return crewDetail(id)!;
}
