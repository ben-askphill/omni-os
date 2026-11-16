// Repeated asks: what Ben keeps asking his agents for, from his own typed messages in an Omni database. Read-only
// and model-free: it opens the database read-only, writes nothing and calls no model. The usage scan
// (apps/server/usage-scan/scan.ts) starts from the same query and grouping.
//
//   npm run repeated-asks --workspace @omni/server -- [--db <path>] [--days 90] [--channel <id>] [--min 6] [--weeks 3]
//                                                     [--top 12] [--tz Europe/Amsterdam] [--samples] [--json]
//
//   --db        the database; default data/omni.db at the checkout root, or OMNI_DATA_DIR's
//   --samples   also print the start of a few asks per group, secrets masked by pattern (not by the secret store's
//               values, which this script does not read)
//   --json      everything as JSON, asks as thread ids and dates only

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readAsks } from '../usage-scan/asks.ts';
import { clusterAsks, describeGroup, spread, type Group } from '../usage-scan/cluster.ts';
import { maskSecrets } from '../usage-scan/mask.ts';

interface Args {
  db: string;
  days: number;
  channel: string | null;
  min: number;
  weeks: number;
  top: number;
  tz: string;
  samples: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    db: join(process.env.OMNI_DATA_DIR ?? resolve(import.meta.dirname, '../../../data'), 'omni.db'),
    days: 90,
    channel: null,
    min: 6,
    weeks: 3,
    top: 12,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    samples: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    const value = () => inline ?? argv[++i];
    if (flag === '--samples') a.samples = true;
    else if (flag === '--json') a.json = true;
    else if (flag === '--db') a.db = resolve(value());
    else if (flag === '--channel') a.channel = value();
    else if (flag === '--tz') a.tz = value();
    else if (flag === '--days' || flag === '--min' || flag === '--weeks' || flag === '--top') {
      const n = Number(value());
      if (!Number.isInteger(n) || n <= 0) fail(`${flag} takes a whole number above 0`);
      a[flag.slice(2) as 'days' | 'min' | 'weeks' | 'top'] = n;
    } else if (flag === '--help' || flag === '-h') {
      console.log('usage: repeated-asks [--db <path>] [--days 90] [--channel <id>] [--min 6] [--weeks 3] [--top 12] [--tz <zone>] [--samples] [--json]');
      process.exit(0);
    } else fail(`unknown argument: ${argv[i]}`);
  }
  return a;
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
if (!existsSync(args.db)) fail(`no database at ${args.db}`);
const db = new DatabaseSync(args.db, { readOnly: true });
const scan = readAsks(db, { days: args.days, channel: args.channel });
const clusters = clusterAsks(scan.asks, { minAsks: args.min, minWeeks: args.weeks, top: args.top, timezone: args.tz });
const pasted = scan.pasted.map((p) => describeGroup(p.asks, args.tz));
db.close();

const masked = (s: string) => maskSecrets(s).text;
const date = (iso: string) => iso.slice(0, 10);
const channels = (g: Group) => g.channels.slice(0, 3).map((c) => `#${c.id} ${c.asks}`).join(', ');
const commandAsks = scan.asks.filter((a) => a.commands.length).length;
const grouped = clusters.reduce((n, c) => n + c.asks.length, 0);

if (args.json) {
  const group = (g: Group) => ({
    asks: g.asks.length,
    weeks: g.weeks,
    first: g.first,
    last: g.last,
    channels: g.channels,
    cadence: g.cadence,
    threads: g.asks.map((a) => ({ id: a.thread_id, at: a.at })),
  });
  console.log(
    JSON.stringify(
      {
        db: args.db,
        days: scan.days,
        since: scan.since,
        asks: scan.asks.length,
        messages: scan.messages,
        with_commands: commandAsks,
        left_out: scan.left_out,
        opted_out: scan.opted_out,
        grouped,
        clusters: clusters.map((c) => ({ id: c.id, key: c.key, kind: c.kind, ...group(c) })),
        pasted: pasted.map(group),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const out: string[] = [];
const lo = scan.left_out;
out.push(`Repeated asks, last ${scan.days} days (since ${date(scan.since)}), read-only from ${args.db}${args.channel ? `, #${args.channel} only` : ''}`);
out.push(`- Asks: ${scan.asks.length + scan.pasted.reduce((n, p) => n + p.asks.length, 0)} threads you started, ${scan.messages} of your messages, ${commandAsks} with a slash command`);
out.push(
  `- Left out: ${lo.automation} automation runs, ${lo.delegated} Conductor or team threads, ${lo.scan} usage scans, ${lo.opted_out} in opted-out channels, ${lo.agent_written} agent-written, ${lo.short} too short, ${lo.duplicate} forks or resumes of an earlier ask`,
);
if (scan.opted_out.length) out.push(`- Opted out: ${scan.opted_out.map((c) => `#${c}`).join(', ')}`);
out.push(`- Grouped: ${grouped} of ${scan.asks.length} asks in ${clusters.length} groups of ${args.min}+ asks over ${args.weeks}+ weeks`);
out.push('');
const describe = (g: Group) =>
  `${g.asks.length} asks over ${g.weeks} weeks, ${date(g.first)} to ${date(g.last)} · ${channels(g)} · about ${g.cadence.per_week} a week, mostly ${String(g.cadence.hour).padStart(2, '0')}:00 · would run ${g.cadence.label} (${g.cadence.cron})`;
const examples = (g: Group) =>
  spread(g.asks, 4).map((a) => `     - ${masked(a.title).slice(0, 90)}${args.samples ? `\n       > ${masked(a.text).slice(0, 160)}` : ''}`);
if (pasted.length) {
  out.push('Prompts you pasted into 3+ threads (kept out of the groups):');
  pasted.forEach((g, i) => out.push(` P${i + 1}. ${describe(g)}`, ...examples(g)));
  out.push('');
}
out.push(clusters.length ? 'Groups, strongest first:' : 'No group reaches the thresholds.');
for (const c of clusters) out.push(` ${c.id}. "${c.key}" (${c.kind}) · ${describe(c)}`, ...examples(c));
console.log(out.join('\n'));
