// "Scan my usage": the deterministic part runs here (asks.ts, cluster.ts), secrets are masked (mask.ts), Haiku labels
// the groups on this machine (labels.ts), and one lead thread in the usage-scan role (crew/usage-scan.md) turns them
// into at most three suggested automations, each split 10/90. The lead creates nothing until Ben says yes in its
// thread, and what it creates starts off (automation-guard.ts holds it to both).
import { askHaiku } from '../runner/aux.ts';
import { loadAutomations } from '../automations.ts';
import { config } from '../config.ts';
import { channels, db, type Thread } from '../db.ts';
import { userName, userPossessive } from '../profile.ts';
import { createThread } from '../runner.ts';
import { getCrew } from '../crew.ts';
import { secretValues } from '../secrets.ts';
import { readAsks, SCAN_ROLE, type Ask } from './asks.ts';
import { clusterAsks, coveredBy, describeGroup, spread, type Cluster, type Group } from './cluster.ts';
import { labelGroups, type Label } from './labels.ts';
import { maskSecrets } from './mask.ts';

export const SCAN_DAYS = 90;
/** Haiku labels every group in one call; past this the scan goes on without labels. */
const LABEL_TIMEOUT_MS = 120_000;
/** Example asks per group: in the lead's prompt, and the start of each in Haiku's. */
const EXAMPLES = 5;
const EXAMPLE_CHARS = 400;
const LABEL_CHARS = 300;

const refused = (message: string, status: 404 | 409) => Object.assign(new Error(message), { status });

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const date = (iso: string) => iso.slice(0, 10);

export interface ScanDeps {
  /** One Haiku call: its output, or null. */
  ask: (prompt: string) => Promise<string | null>;
  /** The values to mask on top of the patterns. */
  secrets: () => Promise<string[]>;
}

const liveDeps: ScanDeps = {
  ask: (prompt) => askHaiku('omni-os-usage-scan', prompt, LABEL_TIMEOUT_MS),
  secrets: secretValues,
};

export interface ScanResult {
  thread: Thread;
  asks: number;
  groups: number;
  pasted: number;
  /** Secrets replaced with [masked] in what went to Haiku and the lead. */
  masked: number;
  /** Haiku labelled the groups; false when its call failed and the lead got them unlabelled. */
  labelled: boolean;
}

/** Starts are one at a time: a second click while the labels run gets a refusal, not a second thread. */
let starting = false;

/** Run the scan over the last SCAN_DAYS days, of one channel or all, and start its lead thread. */
export async function startUsageScan(opts: { channel?: string | null }, deps: ScanDeps = liveDeps): Promise<ScanResult> {
  const channel = opts.channel?.trim() || null;
  if (channel) {
    const ch = channels.get(channel);
    if (!ch) throw refused(`No channel ${channel}.`, 404);
    if (ch.scan_opt_out) throw refused(`#${channel} is left out of usage scans. Turn that off in its settings to scan it.`, 409);
  }
  if (starting) throw refused('A usage scan is starting already.', 409);
  starting = true;
  try {
    const scan = readAsks(db, { days: SCAN_DAYS, channel });
    const clusters = clusterAsks(scan.asks, { timezone: config.timezone });
    const pasted = scan.pasted.map((p) => describeGroup(p.asks, config.timezone));
    if (!clusters.length && !pasted.length)
      throw refused(
        `Nothing repeats enough to suggest an automation yet: ${scan.asks.length} asks in the last ${SCAN_DAYS} days${channel ? ` in #${channel}` : ''}, and no 6 of them share a command, link or phrase over 3 or more weeks.`,
        409,
      );

    const exact = await deps.secrets();
    let masked = 0;
    const mask = (s: string, max: number) => {
      const m = maskSecrets(s, exact);
      masked += m.masked;
      return cut(m.text, max);
    };
    const examples = new Map<Group, { ask: Ask; title: string; text: string }[]>();
    for (const g of [...clusters, ...pasted])
      examples.set(g, spread(g.asks, EXAMPLES).map((a) => ({ ask: a, title: mask(a.title, 90), text: mask(a.text, EXAMPLE_CHARS) })));

    const result = await labelGroups(
      clusters.map((c) => ({ id: c.id, key: c.key, samples: examples.get(c)!.map((e) => cut(e.text, LABEL_CHARS)) })),
      deps.ask,
    );
    const automations = loadAutomations().map((a) => ({
      id: a.id,
      name: mask(a.name, 80),
      enabled: a.enabled,
      when: a.on ? `on ${a.on.event}` : `cron "${a.cron}" (${a.timezone})`,
      channel: a.channel,
      prompt: mask(a.prompt.replace(/\s+/g, ' '), 160),
      full: a.prompt,
    }));
    const prompt = scanPrompt({
      channel,
      days: SCAN_DAYS,
      timezone: config.timezone,
      asks: scan.asks.length,
      messages: scan.messages,
      leftOut: scan.left_out,
      optedOut: scan.opted_out,
      clusters: clusters.map((c) => ({ cluster: c, label: result?.labels.get(c.id), covered: coveredBy(c, automations.map((a) => ({ ...a, prompt: a.full }))), examples: examples.get(c)! })),
      pasted: pasted.map((g) => ({ group: g, examples: examples.get(g)! })),
      automations,
      labelled: !!result,
      masked,
    });
    const day = new Date().toLocaleDateString('en-GB', { timeZone: config.timezone, day: 'numeric', month: 'short' });
    const thread = await createThread({ channel: getCrew(SCAN_ROLE)?.channel ?? 'inbox', role: SCAN_ROLE, title: `Usage scan · ${channel ? `#${channel} · ` : ''}${day}`, prompt, source: 'manual' });
    return { thread, asks: scan.asks.length, groups: clusters.length, pasted: pasted.length, masked, labelled: !!result };
  } finally {
    starting = false;
  }
}

export interface PromptInput {
  channel: string | null;
  days: number;
  timezone: string;
  asks: number;
  messages: number;
  leftOut: Record<string, number>;
  optedOut: string[];
  clusters: { cluster: Cluster; label?: Label; covered: string[]; examples: { ask: Ask; title: string; text: string }[] }[];
  pasted: { group: Group; examples: { ask: Ask; title: string; text: string }[] }[];
  automations: { id: string; name: string; enabled: boolean; when: string; channel: string; prompt: string }[];
  labelled: boolean;
  masked: number;
}

const channelsLine = (g: Group) => g.channels.slice(0, 4).map((c) => `#${c.id} ${c.asks}`).join(', ');
const whenLine = (g: Group, tz: string) =>
  `about ${g.cadence.per_week} a week, mostly around ${String(g.cadence.hour).padStart(2, '0')}:00 (${tz}), ${Math.round(g.cadence.weekdays * 100)}% on weekdays. A schedule that beats it: ${g.cadence.label}, \`${g.cadence.cron}\``;
const exampleLines = (xs: PromptInput['clusters'][number]['examples']) =>
  xs.map((e) => `  - "${e.title}" (#${e.ask.channel_id}, ${date(e.ask.at)}, thread ${e.ask.thread_id}): ${e.text}`);

/** The lead's first message: everything it needs, already masked, so it never reads a transcript. */
export function scanPrompt(p: PromptInput): string {
  const lo = p.leftOut;
  const name = userName();
  const out = [
    `# Usage scan: last ${p.days} days, ${p.channel ? `#${p.channel} only` : 'all channels'}`,
    '',
    `Omni read the messages ${name} typed to their agents and grouped what they ask for again and again: ${p.asks} asks (the first message of each thread ${name} started), ${p.messages} messages in all.`,
    `Left out: ${lo.automation ?? 0} automation runs and their threads, ${lo.delegated ?? 0} Conductor or team threads (agent-written briefs), ${lo.agent_written ?? 0} agent-written, ${lo.short ?? 0} too short, ${lo.duplicate ?? 0} forks or resumes${p.optedOut.length ? `, and the channels that opted out: ${p.optedOut.map((c) => `#${c}`).join(', ')}` : ''}.`,
    `Secrets are masked: ${p.masked} replaced with [masked]. ${p.labelled ? "The labels are Haiku's, made on this machine." : 'Haiku could not label the groups this time; read the examples instead.'} #imported is ${userPossessive()} Claude Code history from before Omni.`,
    '',
    `Follow your role: patterns, the 10/90 split, then ask ${name} which ones to save. Use only this message.`,
    '',
    '## Groups, strongest first',
  ];
  if (!p.clusters.length) out.push('', 'None: no 6 asks share a command, link or phrase over 3 or more weeks.');
  for (const { cluster: c, label, covered, examples } of p.clusters) {
    out.push(
      '',
      `### ${c.id} · shares "${c.key}" · ${c.asks.length} asks over ${c.weeks} weeks (${date(c.first)} to ${date(c.last)})`,
      ...(label ? [`- Haiku: ${label.what}${label.tags.length ? ` (${label.tags.join(', ')})` : ''}${label.agentWritten ? '. Haiku thinks an agent wrote these.' : ''}`] : []),
      `- Channels: ${channelsLine(c)}`,
      `- When: ${whenLine(c, p.timezone)}`,
      ...(covered.length ? [`- May already run as: ${covered.join(', ')}`] : []),
      '- Examples (masked, trimmed):',
      ...exampleLines(examples),
    );
  }
  if (p.pasted.length) {
    out.push('', '## Long prompts sent in 3 or more threads with the same start', `Usually a script or a template, not typed. Count one only if it plainly is ${name} pasting the same request.`);
    p.pasted.forEach(({ group: g, examples }, i) =>
      out.push('', `### P${i + 1} · ${g.asks.length} threads over ${g.weeks} weeks (${date(g.first)} to ${date(g.last)})`, `- Channels: ${channelsLine(g)}`, `- When: ${whenLine(g, p.timezone)}`, '- Examples (masked, trimmed):', ...exampleLines(examples.slice(0, 2))),
    );
  }
  out.push('', '## Automations that exist now', 'Work one of these already does does not count, even when it is off.', '');
  if (!p.automations.length) out.push('None.');
  else {
    out.push('| id | name | on | runs | channel | prompt starts |', '|---|---|---|---|---|---|');
    for (const a of p.automations) out.push(`| ${a.id} | ${a.name} | ${a.enabled ? 'yes' : 'no'} | ${a.when} | #${a.channel} | ${a.prompt.replace(/\|/g, '/')} |`);
  }
  return out.join('\n');
}
