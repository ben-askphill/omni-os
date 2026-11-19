// Writing automations from the clients. Every change lands in a YAML file: the user's own in data/automations/. A
// shipped one in automations/ is copied there on its first change (same id wins, automations.ts), so an update of the
// checkout never collides with an edit, and Reset drops the copy. Comments in the file survive an edit. With sync on,
// the written file goes to the other machines too (sync/handlers/automation-file.ts), so both agree on `machine:`.
// A `precheck:` is a command a login shell runs before each scheduled run, so only a caller that may reach a shell
// (request-trust.ts mayUseShell) makes one run that did not: a new or changed command, or a schedule for a file whose
// precheck never ran, or moving one to another channel, whose folder it runs in. The editor's fields never carry it;
// the raw YAML can. Removing one, or saving over a file whose precheck already runs where it ran, stays open: neither
// puts a new command in a shell.

import { existsSync, readFileSync } from 'node:fs';
import YAML, { Document, isMap, isScalar, Scalar } from 'yaml';
import { z } from 'zod';
import { parseTrigger } from './automation-events.ts';
import { loadAutomations, parseAutomation, schedule, type Automation } from './automations.ts';
import { AUTOMATION_ID, fileOf, personalFile, removeOwnFileOnDisk, writeOwnFile } from './automation-store.ts';
import { paths } from './config.ts';
import { channels, outbox } from './db.ts';
import { record } from './db/sync.ts';
import { getCatalog } from './harness/catalog-service.ts';
import { validateDefaults } from './harness/resolve.ts';
import { currentRecords, deviceRecords } from './sync/device-records.ts';
import { resolveMachine } from './sync/owner.ts';
import { SHELL_REFUSAL } from './request-trust.ts';
import { userConfig } from './user-config.ts';

const refused = (message: string, status: 400 | 403 | 404 | 409 = 400) => Object.assign(new Error(message), { status });

const optText = (max: number) => z.string().trim().max(max).optional();

/** What the editor sends. Empty optional text clears the key from the file. Unknown keys already in the file stay. */
export const automationFields = z
  .object({
    name: z.string().trim().min(1, 'Give it a name').max(120),
    enabled: z.boolean(),
    /** A schedule. Set this or `on`, not both. */
    cron: optText(200),
    /** An event, in the shape `on:` takes (automation-events.ts parseTrigger). */
    on: z.unknown().optional(),
    timezone: optText(80),
    catchup: z.boolean().optional(),
    channel: z.string().trim().min(1).max(100),
    /** A sync machine id, `here`, or empty for the shared "Run automations on" choice. */
    machine: optText(200),
    role: optText(80),
    harness: optText(80),
    model: optText(120),
    effort: optText(40),
    /** Post nothing when there is nothing to report (automation-quiet.ts). */
    quiet: z.boolean().optional(),
    /** Ask on the question card before acting outside Omni (automation-rules.ts). */
    approve: z.boolean().optional(),
    /** How long an unanswered approval waits before it expires, like 8h. Needs `approve`. */
    expires: optText(20),
    prompt: z.string().max(100_000),
  })
  .strict();
export type AutomationFields = z.infer<typeof automationFields>;

/** The order keys go in a new file, and where a key new to an old file is placed: before the next one here that it has. */
const ORDER = ['name', 'enabled', 'cron', 'on', 'timezone', 'catchup', 'channel', 'machine', 'role', 'harness', 'model', 'effort', 'quiet', 'approve', 'expires', 'prompt'] as const;

export interface AutomationDefinition {
  id: string;
  /** The file the automation loads from now. */
  file: string;
  /** automations/ has a file of this id. */
  shipped: boolean;
  /** data/automations/ has one: the user's own, or their copy of the shipped one. */
  personal: boolean;
  yaml: string;
  /** The fields as written in the file: the prompt with its {{placeholders}}, `machine` as named there. */
  fields: AutomationFields & { machine_id: string | null };
}


/** The YAML an automation loads from now: the user's own file, else the shipped one. */
function sourceOf(id: string): { file: string; shipped: boolean; personal: boolean } | null {
  const own = fileOf(paths.personalAutomations, id);
  const shipped = !!fileOf(paths.automations, id) && !userConfig().automations[id]?.deleted;
  const file = own ?? (shipped ? fileOf(paths.automations, id) : undefined);
  return file ? { file, shipped, personal: !!own } : null;
}

/** Where an automation's YAML comes from: shipped in automations/, the user's copy of a shipped one, or the user's own. */
export function sourceKind(id: string): 'shipped' | 'edited' | 'own' {
  const src = sourceOf(id);
  return !src?.personal ? 'shipped' : src.shipped ? 'edited' : 'own';
}

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

export function definitionOf(id: string): AutomationDefinition | null {
  const src = sourceOf(id);
  if (!src) return null;
  const yaml = readFileSync(src.file, 'utf8');
  let y: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(yaml);
    if (parsed && typeof parsed === 'object') y = parsed;
  } catch {
    // Shown as the raw text only; the editor opens on the YAML tab.
  }
  const o = userConfig().automations[id];
  const machine = str(y.machine).trim();
  return {
    id,
    ...src,
    yaml,
    fields: {
      name: str(y.name) || id,
      enabled: o?.enabled ?? y.enabled === true,
      cron: str(y.cron),
      ...(y.on !== undefined && { on: y.on }),
      timezone: str(y.timezone),
      catchup: y.catchup === true,
      channel: o?.channel ?? (str(y.channel) || 'inbox'),
      machine,
      machine_id: machine ? resolveMachine(machine) : null,
      role: str(y.role),
      harness: str(y.harness),
      model: str(y.model),
      effort: str(y.effort),
      quiet: y.quiet === true,
      approve: y.approve === true,
      expires: str(y.expires),
      prompt: str(y.prompt).replace(/\n+$/, ''),
    },
  };
}

/** How the file names a machine: its name when no other synced machine shares it, else its id. */
function machineValue(asked: string): string {
  const self = outbox.machineId();
  if (!self) throw refused('Set up sync to choose a machine for one automation. Without it, every automation runs here.', 409);
  const id = asked === 'here' ? self : resolveMachine(asked);
  if (!id) throw refused(`No synced machine is called ${asked}.`);
  const all = currentRecords(deviceRecords());
  const name = all.find((d) => d.id === id)?.name;
  return name && all.filter((d) => d.name.toLowerCase() === name.toLowerCase()).length === 1 ? name : id;
}

/** `on:` as the file should say it: a bare event name when nothing else is set, else the block without its defaults. */
function triggerValue(raw: unknown): unknown {
  const t = parseTrigger(raw);
  if (typeof t === 'string') throw refused(`Trigger: ${t}`);
  const out: Record<string, unknown> = { event: t.event };
  for (const [k, v] of Object.entries(t)) {
    if (k === 'event' || v === false || v === undefined) continue;
    // Both webhook events are the default.
    if (k === 'events' && Array.isArray(v) && v.length === 2) continue;
    out[k] = v;
  }
  return Object.keys(out).length === 1 ? t.event : out;
}

/** Set or clear one top-level key, keeping the file's order and comments. A key new to the file goes where ORDER puts it. */
function setKey(doc: Document, key: (typeof ORDER)[number], value: unknown) {
  const map = doc.contents;
  if (!isMap(map)) throw refused('The file is not a YAML map.');
  if (value === undefined || value === '' || value === null) {
    map.delete(key);
    return;
  }
  let node: unknown = doc.createNode(value);
  if (key === 'prompt' && typeof value === 'string') {
    const s = new Scalar(value.endsWith('\n') ? value : `${value}\n`);
    s.type = Scalar.BLOCK_LITERAL;
    node = s;
  } else if (key === 'cron' || key === 'machine' || key === 'name' || key === 'expires') {
    // A cron of `*/5 * * * *` reads as an alias unquoted; a name or machine can look like a number or a bool.
    const s = new Scalar(String(value));
    s.type = key === 'cron' ? Scalar.QUOTE_DOUBLE : Scalar.PLAIN;
    node = s;
  } else if (key === 'on' && isMap(node)) {
    node.flow = true;
  }
  const at = map.items.findIndex((p) => isScalar(p.key) && p.key.value === key);
  if (at >= 0) {
    map.items[at].value = node as never;
    return;
  }
  const after = ORDER.slice(ORDER.indexOf(key) + 1);
  const before = map.items.findIndex((p) => isScalar(p.key) && (after as readonly unknown[]).includes(p.key.value));
  const pair = doc.createPair(key, null);
  pair.value = node as never;
  if (before < 0) map.items.push(pair);
  else map.items.splice(before, 0, pair);
}

/** The file's text for these fields, starting from what it says now so comments and keys the editor does not know stay. */
function render(base: string | null, f: AutomationFields): string {
  const doc = base ? YAML.parseDocument(base) : new Document({});
  if (doc.errors.length) throw refused(`The file is not valid YAML: ${doc.errors[0].message}. Fix it in the YAML tab.`);
  if (!isMap(doc.contents)) doc.contents = doc.createNode({}) as never;
  const cron = f.cron?.trim() || '';
  const on = f.on === undefined || f.on === null || f.on === '' ? undefined : f.on;
  if (cron && on) throw refused('Set a schedule or an event, not both.');
  if (!cron && !on) throw refused('Set a schedule or an event.');
  setKey(doc, 'name', f.name);
  setKey(doc, 'enabled', f.enabled);
  setKey(doc, 'cron', cron);
  setKey(doc, 'on', on === undefined ? undefined : triggerValue(on));
  // A schedule's own settings mean nothing to an event automation.
  setKey(doc, 'timezone', cron ? f.timezone : undefined);
  setKey(doc, 'catchup', cron && f.catchup ? true : undefined);
  setKey(doc, 'channel', f.channel);
  const written = str(doc.get('machine')).trim();
  setKey(doc, 'machine', !f.machine ? undefined : f.machine === written ? written : machineValue(f.machine));
  for (const k of ['role', 'harness', 'model', 'effort'] as const) setKey(doc, k, f[k]);
  setKey(doc, 'quiet', f.quiet ? true : undefined);
  setKey(doc, 'approve', f.approve ? true : undefined);
  // An expiry means nothing without approval.
  setKey(doc, 'expires', f.approve ? f.expires : undefined);
  setKey(doc, 'prompt', f.prompt.trim() ? f.prompt : undefined);
  return doc.toString({ lineWidth: 0 });
}

/** Refuses a file Omni would load as invalid. A missing Omni checkout is this machine's, not the file's, so it passes. */
function check(id: string, text: string, channel: string | undefined): Automation {
  const a = parseAutomation(id, text, personalFile(id));
  if (a.error && !a.error.startsWith('needs an Omni checkout')) throw refused(a.error);
  const bad = validateDefaults({ harness: a.harness, model: a.model, effort: a.effort }, getCatalog());
  if (bad) throw refused(bad);
  const ch = channel ?? a.channel;
  if (!channels.get(ch)) throw refused(`No channel ${ch}.`);
  return a;
}

/** Write the user's file for this id, then tell sync and the scheduler. */
function write(id: string, text: string) {
  writeOwnFile(id, text);
  record('automation_file', id);
  schedule();
}

/** A new automation from the editor's fields. The id is the file's name: given, or made from the name. */
export function createAutomation(f: AutomationFields, id?: string): AutomationDefinition {
  const want = (id?.trim() || f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).slice(0, 64);
  if (!AUTOMATION_ID.test(want)) throw refused('The id takes lowercase letters, digits and dashes.');
  if (loadAutomations().some((a) => a.id === want) || existsSync(personalFile(want))) throw refused(`An automation called ${want} exists already.`, 409);
  const text = `# Made in Omni's Automations page. Edits there rewrite this file; comments stay.\n${render(null, f)}`;
  check(want, text, f.channel);
  write(want, text);
  return definitionOf(want)!;
}

/** What the caller of a save may do: `shell` when its request may reach a shell (request-guard.ts shellAllowed). */
export interface AutomationWriteBy {
  shell?: boolean;
}

/**
 * The precheck a file would run on its next scheduled run, with the channel whose folder it runs in (automations.ts
 * precheckDir), or null: none, or one that never runs because the file is an event automation or does not load. The
 * same command in another channel's folder is another command (`./check.sh` is whatever that folder holds). A missing
 * Omni checkout is this machine's, not the file's (check below).
 */
function scheduledPrecheck(id: string, text: string, channel?: string): string | null {
  const a = parseAutomation(id, text);
  if ((a.error && !a.error.startsWith('needs an Omni checkout')) || a.on || !a.precheck) return null;
  return JSON.stringify([channel || a.channel, a.precheck.command]);
}

/**
 * Save the editor's fields over an automation's file, or its raw YAML. A shipped one becomes the user's own copy. A
 * precheck that would run where none ran before, with another command or in another channel's folder, needs a caller
 * that may reach a shell: so
 * does turning an event automation, or one that did not load, that carries one into a scheduled one. One that already
 * runs can stay.
 */
export function saveAutomation(id: string, change: { fields: AutomationFields } | { yaml: string }, by: AutomationWriteBy = {}): AutomationDefinition {
  const src = sourceOf(id);
  if (!src) throw refused('No automation with this id.', 404);
  const base = readFileSync(src.file, 'utf8');
  const text = 'yaml' in change ? keepChannelOverride(id, base, change.yaml) : render(base, change.fields);
  const precheck = scheduledPrecheck(id, text);
  // The file as it runs now: with the config's channel override (automations.ts loadAutomations), which a write drops.
  if (!by.shell && precheck !== null && precheck !== scheduledPrecheck(id, base, userConfig().automations[id]?.channel)) throw refused(`Forbidden: ${SHELL_REFUSAL}`, 403);
  check(id, text, 'fields' in change ? change.fields.channel : undefined);
  write(id, text);
  return definitionOf(id)!;
}

/** Turn one on or off, in its file. */
export function setAutomationEnabled(id: string, enabled: boolean) {
  const src = sourceOf(id);
  if (!src) throw refused('No automation with this id.', 404);
  const doc = YAML.parseDocument(readFileSync(src.file, 'utf8'));
  if (doc.errors.length || !isMap(doc.contents)) throw refused('The file is not valid YAML. Fix it first.');
  setKey(doc, 'enabled', enabled);
  const channel = userConfig().automations[id]?.channel;
  if (channel) setKey(doc, 'channel', channel);
  write(id, doc.toString({ lineWidth: 0 }));
}

/** Raw YAML that leaves the file's channel as it was keeps this machine's old channel override, which the write drops. */
function keepChannelOverride(id: string, base: string, text: string): string {
  const channel = userConfig().automations[id]?.channel;
  if (!channel) return text;
  const doc = YAML.parseDocument(text);
  if (doc.errors.length || !isMap(doc.contents)) return text;
  let was: unknown;
  try {
    was = (YAML.parse(base) as Record<string, unknown> | null)?.channel;
  } catch {
    return text;
  }
  if (str(doc.get('channel')) !== str(was)) return text;
  setKey(doc, 'channel', channel);
  return doc.toString({ lineWidth: 0 });
}

/** Drop the user's copy of a shipped automation, so the shipped file loads again. */
export function resetAutomation(id: string): AutomationDefinition {
  const src = sourceOf(id);
  if (!src?.personal || !src.shipped) throw refused('Only an edited copy of a shipped automation can be reset.', 409);
  removeOwnFile(id);
  return definitionOf(id)!;
}

/** Remove the user's file for this id, and from the other machines. */
function removeOwnFile(id: string) {
  if (!removeOwnFileOnDisk(id)) return;
  record('automation_file', id, 'delete');
  schedule();
}
