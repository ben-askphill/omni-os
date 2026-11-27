// OpenCode's model list (spec section 8): read from a session `opencode acp` opens, kept on disk.
// - The list is the `model` option of session/new (116 entries on a machine whose shell has provider keys). Ids are
//   `provider/model`. Only `opencode/...` (OpenCode Zen) is listed by default; every other provider bills elsewhere and
//   is hidden until switched on (hiddenUntilOn).
// - A model's effort levels are the `thought_level` option OpenCode shows once the model is selected, so the reader
//   selects each Zen model once and then the first one again. Other providers' models are not selected: that would
//   touch a provider whose key Omni did not choose.
// - The last good list is kept in opencode-models.json, so a failed check and a restart still list models.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../../config.ts';
import type { AcpClient } from '../acp/client.ts';
import { labelled, parseEfforts, parseModelList } from '../antigravity/models.ts';
import { ZEN } from './pick.ts';

export interface OpenCodeModel {
  id: string;
  label: string;
  /** Effort levels this model offers, `default` left out. Empty: none. */
  efforts: string[];
  /** The level in force when the model was selected, when it is one of the levels. */
  defaultEffort: string;
  /** Bills somewhere other than Zen's free tier: hidden until switched on. */
  other: boolean;
}

export { defaultModel, PREFERRED, ZEN } from './pick.ts';

const SELECT_MS = 10_000;
const levels = (efforts: string[]) => efforts.filter((e) => e !== 'default');

/** The models of a session just opened. Selects each Zen model once, then the first again. */
export async function readModels(client: AcpClient, sessionId: string, answer: unknown): Promise<OpenCodeModel[]> {
  const list = parseModelList(answer);
  const labels = new Map(labelled(list).map((m) => [m.id, m.label]));
  const out: OpenCodeModel[] = [];
  for (const m of list) {
    const other = !m.id.startsWith(ZEN);
    let efforts: string[] = [];
    let defaultEffort = '';
    if (!other) {
      try {
        const r = parseEfforts(await client.request('session/set_config_option', { sessionId, configId: 'model', value: m.id }, SELECT_MS));
        efforts = levels(r.efforts);
        defaultEffort = efforts.includes(r.current) ? r.current : '';
      } catch {
        /* a model that will not select still lists, without levels */
      }
    }
    out.push({ id: m.id, label: labels.get(m.id) ?? m.name, efforts, defaultEffort, other });
  }
  const first = list.find((m) => m.current) ?? list.find((m) => m.id.startsWith(ZEN));
  if (first && list.some((m) => m.id.startsWith(ZEN))) await client.request('session/set_config_option', { sessionId, configId: 'model', value: first.id }, SELECT_MS).catch(() => {});
  return out;
}

// ---------- the list on disk ----------

const file = () => join(paths.data, 'opencode-models.json');
let memory: OpenCodeModel[] | null = null;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function valid(raw: unknown): OpenCodeModel[] {
  const out: OpenCodeModel[] = [];
  for (const m of Array.isArray(raw) ? raw : []) {
    if (!str(m?.id) || !str(m?.label)) continue;
    const efforts = Array.isArray(m.efforts) ? m.efforts.filter((e: unknown): e is string => typeof e === 'string') : [];
    out.push({ id: m.id, label: m.label, efforts, defaultEffort: efforts.includes(m.defaultEffort) ? m.defaultEffort : '', other: !String(m.id).startsWith(ZEN) });
  }
  return out;
}

/** The last list OpenCode gave, here or before a restart. Empty before the first one. */
export function lastModels(): OpenCodeModel[] {
  if (memory) return memory;
  try {
    memory = valid((JSON.parse(readFileSync(file(), 'utf8')) as { models?: unknown }).models);
  } catch {
    memory = [];
  }
  return memory;
}

/** Keep a list OpenCode just gave. An empty one is not kept: it would lose the last good list. */
export function keepModels(models: OpenCodeModel[]) {
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
