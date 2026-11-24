// Antigravity's model list (spec #977, ticket #979): read from a session agy opens, kept on disk.
// - The list is the `model` option of session/new's configOptions (groups flattened), else models.availableModels.
// - A model's effort levels are the `thought_level` option agy shows once that model is selected, so the reader
//   selects each model once and then selects the first one again.
// - Two models with one name get their id after the name.
// - The last good list is kept in antigravity-models.json (like claude-models.json), so a failed refresh and a
//   restart still list models.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../../config.ts';
import type { AcpClient } from '../acp/client.ts';

export interface AgyModel {
  id: string;
  label: string;
  /** Effort levels agy offers on this model. Empty: none. */
  efforts: string[];
  /** The level agy picked when the model was selected. Empty when it has none. */
  defaultEffort: string;
}

interface Option {
  value: string;
  name: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A select option's choices, with groups flattened. */
function choices(raw: unknown): Option[] {
  const out: Option[] = [];
  for (const o of Array.isArray(raw) ? raw : []) {
    if (Array.isArray(o?.options)) out.push(...choices(o.options));
    else if (str(o?.value)) out.push({ value: o.value, name: str(o.name) ?? o.value });
  }
  return out;
}

function option(answer: unknown, id: string): { current: string | null; choices: Option[] } | null {
  const list = (answer as { configOptions?: unknown })?.configOptions;
  const o = (Array.isArray(list) ? list : []).find((x) => x?.id === id || x?.category === id);
  return o ? { current: str(o.currentValue), choices: choices(o.options) } : null;
}

/** The models in a session/new answer: its `model` option, else models.availableModels. */
export function parseModelList(answer: unknown): { id: string; name: string; current: boolean }[] {
  const o = option(answer, 'model');
  const current = o?.current ?? str((answer as { models?: { currentModelId?: unknown } })?.models?.currentModelId);
  const seen = new Set<string>();
  const list = o?.choices.length
    ? o.choices
    : (((answer as { models?: { availableModels?: unknown } })?.models?.availableModels as { modelId?: unknown; name?: unknown }[]) ?? []).flatMap((m) => (str(m?.modelId) ? [{ value: m.modelId as string, name: str(m.name) ?? (m.modelId as string) }] : []));
  return list.filter((m) => !seen.has(m.value) && !!seen.add(m.value)).map((m) => ({ id: m.value, name: m.name, current: m.value === current }));
}

/** Labels for the list: the name, and the id after it when two models share a name. */
export function labelled(list: { id: string; name: string }[]): { id: string; label: string }[] {
  const count = new Map<string, number>();
  for (const m of list) count.set(m.name, (count.get(m.name) ?? 0) + 1);
  return list.map((m) => ({ id: m.id, label: (count.get(m.name) ?? 0) > 1 ? `${m.name} (${m.id})` : m.name }));
}

/** The effort levels a configOptions answer shows, with the one in force. */
export function parseEfforts(answer: unknown): { efforts: string[]; current: string } {
  const o = option(answer, 'thought_level');
  return { efforts: o?.choices.map((c) => c.value) ?? [], current: o?.current ?? '' };
}

const SELECT_MS = 10_000;

/**
 * The models of a session just opened, each with its effort levels. Selects every model once, then the first one
 * again, so the session ends on the model it began on. A model that will not select keeps no levels.
 */
export async function readModels(client: AcpClient, sessionId: string, answer: unknown): Promise<AgyModel[]> {
  const list = parseModelList(answer);
  const labels = new Map(labelled(list).map((m) => [m.id, m.label]));
  const out: AgyModel[] = [];
  for (const m of list) {
    let efforts: string[] = [];
    let defaultEffort = '';
    try {
      const r = parseEfforts(await client.request('session/set_config_option', { sessionId, configId: 'model', value: m.id }, SELECT_MS));
      efforts = r.efforts;
      defaultEffort = efforts.includes(r.current) ? r.current : '';
    } catch {
      /* a model that will not select still lists, without levels */
    }
    out.push({ id: m.id, label: labels.get(m.id) ?? m.name, efforts, defaultEffort });
  }
  const first = list.find((m) => m.current) ?? list[0];
  if (first && list.length > 1) await client.request('session/set_config_option', { sessionId, configId: 'model', value: first.id }, SELECT_MS).catch(() => {});
  return out;
}

// ---------- the list on disk ----------

const file = () => join(paths.data, 'antigravity-models.json');
let memory: AgyModel[] | null = null;

function valid(raw: unknown): AgyModel[] {
  const out: AgyModel[] = [];
  for (const m of Array.isArray(raw) ? raw : []) {
    if (!str(m?.id) || !str(m?.label)) continue;
    const efforts = Array.isArray(m.efforts) ? m.efforts.filter((e: unknown): e is string => typeof e === 'string') : [];
    out.push({ id: m.id, label: m.label, efforts, defaultEffort: efforts.includes(m.defaultEffort) ? m.defaultEffort : '' });
  }
  return out;
}

/** The last list agy gave, here or before a restart. Empty before the first one. */
export function lastModels(): AgyModel[] {
  if (memory) return memory;
  try {
    memory = valid((JSON.parse(readFileSync(file(), 'utf8')) as { models?: unknown }).models);
  } catch {
    memory = [];
  }
  return memory;
}

/** Keep a list agy just gave. An empty one is not kept: it would lose the last good list. */
export function keepModels(models: AgyModel[]) {
  if (!models.length) return;
  memory = models;
  try {
    writeFileSync(file(), JSON.stringify({ models, at: Date.now() }));
  } catch {
    /* the list still works from memory */
  }
}

/** For tests: forget the list in memory, so the next read comes from disk. */
export function forgetModels() {
  memory = null;
}
