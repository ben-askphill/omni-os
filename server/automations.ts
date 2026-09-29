import { readdirSync, readFileSync, writeFileSync, existsSync, watch } from 'node:fs';
import { join } from 'node:path';
import { Cron } from 'croner';
import YAML from 'yaml';
import { config, paths } from './config.ts';
import { automationRuns, db } from './db.ts';
import { createThread } from './runner.ts';

export interface Automation {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  channel: string;
  role?: string;
  harness?: string;
  model?: string;
  effort?: string;
  prompt: string;
  enabled: boolean;
  file: string;
  error?: string;
  next?: string | null;
}

export function parseAutomation(id: string, src: string, file = ''): Automation {
  let y: any = {};
  let yamlError: string | undefined;
  try {
    y = YAML.parse(src) ?? {};
  } catch (err) {
    yamlError = `bad yaml: ${(err as Error).message}`;
  }
  const a: Automation = {
    id,
    name: y.name ?? id,
    cron: String(y.cron ?? ''),
    timezone: y.timezone ?? config.timezone,
    channel: y.channel ?? 'inbox',
    role: y.role,
    harness: y.harness,
    model: y.model,
    effort: y.effort,
    prompt: String(y.prompt ?? '').trim(),
    enabled: y.enabled === true,
    file,
  };
  if (yamlError) (a.error = yamlError), (a.enabled = false);
  else if (!a.cron) a.error = 'missing cron';
  else if (!a.prompt) a.error = 'missing prompt';
  else {
    try {
      a.next = new Cron(a.cron, { timezone: a.timezone, paused: true }).nextRun()?.toISOString() ?? null;
    } catch (err) {
      a.error = `invalid schedule (cron "${a.cron}", timezone "${a.timezone}"): ${(err as Error).message}`;
    }
  }
  return a;
}

export function loadAutomations(): Automation[] {
  if (!existsSync(paths.automations)) return [];
  return readdirSync(paths.automations)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => {
      const file = join(paths.automations, f);
      return parseAutomation(f.replace(/\.ya?ml$/, ''), readFileSync(file, 'utf8'), file);
    });
}

const jobs = new Map<string, Cron>();

export async function runAutomation(a: Automation, trigger: 'cron' | 'manual') {
  const date = new Date().toLocaleDateString('en-GB', { timeZone: a.timezone, day: 'numeric', month: 'short' });
  const thread = await createThread({
    channel: a.channel,
    role: a.role,
    harness: a.harness,
    model: a.model,
    effort: a.effort,
    prompt: a.prompt,
    title: `${a.name} · ${date}`,
    source: 'automation',
    automation: a.id,
  });
  automationRuns.add(a.id, thread.id, trigger);
  return thread;
}

export function lastRuns(id: string, limit = 10) {
  return db
    .prepare(
      `SELECT r.id, r.automation, r.thread_id, r.trigger, r.created_at, t.status, t.title FROM automation_runs r LEFT JOIN threads t ON t.id = r.thread_id
       WHERE r.automation = ? ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
    )
    .all(id, limit);
}

export function schedule() {
  try {
    scheduleAll();
  } catch (err) {
    console.error('[automations] could not load automations:', err);
  }
}

function scheduleAll() {
  for (const j of jobs.values()) j.stop();
  jobs.clear();
  for (const a of loadAutomations()) {
    if (!a.enabled || a.error) continue;
    jobs.set(
      a.id,
      new Cron(a.cron, { timezone: a.timezone, protect: true }, () => {
        runAutomation(a, 'cron').catch((err) => console.error(`[automations] ${a.id} failed:`, err));
      }),
    );
  }
  console.log(`[automations] ${jobs.size} scheduled`);
}

export function setEnabled(id: string, enabled: boolean) {
  const a = loadAutomations().find((x) => x.id === id);
  if (!a) throw new Error('automation not found');
  const doc = YAML.parseDocument(readFileSync(a.file, 'utf8'));
  doc.set('enabled', enabled);
  writeFileSync(a.file, doc.toString());
  schedule();
}

export function startScheduler() {
  schedule();
  let t: NodeJS.Timeout | undefined;
  watch(paths.automations, () => {
    clearTimeout(t);
    t = setTimeout(schedule, 300);
  });
}
