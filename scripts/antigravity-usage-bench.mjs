#!/usr/bin/env node
// What one fixed Antigravity task costs: a three-turn researcher task (read three call notes, read a CSV, draft a
// reply) run as an Omni thread on a QA stack with the real agy, then read back from agy's own record of every model
// call in that conversation (its conversations/<session>.db). A live run spends the signed-in Google AI plan.
//
//   QA_ANTIGRAVITY_BIN=$(command -v agy) QA_NO_WEB=1 QA_BROWSER=1 scripts/qa-stack.sh up --seed 0
//   QA_SERVER_PORT=4757 node scripts/antigravity-usage-bench.mjs <label> [model] [effort]
//
// It prints, per model call, the prompt tokens agy sent fresh, the ones it read from the prompt cache and the output
// (thinking included), and a cost in fresh-input-token units: fresh 1, cached 0.05, output 5. Those weights come from
// /usage deltas of single-call probes on Gemini 4 Neon (2026-11-26) and are approximate; /usage reads are account wide,
// so another machine's turns move them. The decoder reads agy's gen_metadata rows: field 1.4 holds the usage
// (2 fresh prompt, 5 cached prompt, 3 output, 9 thinking). agy does not document that layout; it was read from
// agy 1.5.18 and may change with an update.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = process.env.QA_SERVER_PORT ?? '4757';
const DATA = process.env.QA_DIR ? join(process.env.QA_DIR, 'data') : join(process.env.TMPDIR ?? tmpdir(), `omni-qa-${PORT}`, 'data');
const API = `http://127.0.0.1:${PORT}/api`;
const TOKEN = process.env.QA_TOKEN ?? execFileSync('cat', [join(DATA, 'api-token')], { encoding: 'utf8' }).trim();
const [label = 'run', model = 'gemini-4-neon', effort = ''] = process.argv.slice(2);
const HOMES = (process.env.AGY_HOMES ?? homedir()).split(':');
const OUT = process.env.BENCH_OUT ?? mkdtempSync(join(tmpdir(), 'agy-bench-'));
const WEIGHTS = { fresh: 1, cached: 0.05, output: 5 };

const FILES = {
  'notes/2026-10-02-kickoff.md': `# North Coast Outfitters: kickoff call (2026-10-02)

Attendees: Ben (Ask Phill), Wouter (client, ecommerce lead), Sanne (client, finance)

- Store launches in five EU markets in Q1: Netherlands, Belgium, Germany, Italy, Romania.
- Wouter wants one Shopify store with Markets, not expansion stores.
- Default market question parked: Romania was suggested because the warehouse ships from Bucharest.
- Sanne: prices are set in EUR for every market except Romania (RON).
- Action: Ben to check whether the default market can use English while the primary domain stays northcoast.com.
`,
  'notes/2026-10-16-markets.md': `# Markets working session (2026-10-16)

Attendees: Ben, Wouter

- Decided: the primary domain northcoast.com serves the Europe market group, English, no subfolder.
- Decided: Romania will NOT be the default market. Reason: RON as the default currency breaks the EUR price lists and the Klarna setup.
- Open: Wouter prefers Italy as default but with English content. Ben to confirm whether a market's default language can differ from the country's language.
- Netherlands is the fallback default if Italy-with-English is not possible.
- Action: Sanne to send the final VAT rates per country.
`,
  'notes/2026-11-03-followup.md': `# Follow-up (2026-11-03)

Attendees: Ben, Wouter, Sanne

- Confirmed: in Shopify Markets a market's default language is set per market and can be English for Italy.
- Risk: Italian customers landing on the root domain see English; Wouter accepts this for launch.
- Decided: Italy becomes the default market, English as its default language, Italian on /it.
- Sanne sent VAT rates (see pricing.csv).
- Action: Ben to write the reply to Wouter's latest Slack message summing this up.
`,
  'pricing.csv': `country,currency,vat_rate,shipping_eur,free_shipping_from_eur
Netherlands,EUR,21%,4.95,75
Belgium,EUR,21%,5.95,75
Germany,EUR,19%,4.95,60
Italy,EUR,22%,6.95,90
Romania,RON,19%,7.95,100
`,
};
const TURNS = [
  "Ben needs to reply to Wouter about the default market. Read the call notes in the notes/ folder of this channel's folder and tell me what was decided about the default market, with the date of each decision. Keep it short.",
  'Check pricing.csv in the same folder: what VAT rate and free-shipping threshold apply in the market that was chosen as default?',
  'Now draft a short Slack reply to Wouter, four sentences at most, that sums up the decision and those numbers.',
];

const headers = { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
async function api(method, path, body) {
  const r = await fetch(API + path, { method, headers, body: body && JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The Gemini group's remaining fractions from agy's own /usage, for a rough cross-check. */
function allowance() {
  try {
    const out = execFileSync('agy', ['-p', '/usage', '--output-format', 'json'], { cwd: OUT, encoding: 'utf8' });
    const group = JSON.parse(out).command.data.groups.find((g) => /Gemini/.test(g.name));
    return Object.fromEntries(group.buckets.map((b) => [b.window, b.remaining_fraction]));
  } catch {
    return {};
  }
}

/** Waits until the thread has `turns` results and is no longer running. */
async function settled(id, turns) {
  for (let i = 0; i < 900; i++) {
    const detail = await api('GET', `/threads/${id}`);
    const thread = detail.thread ?? detail;
    const results = (detail.events ?? []).filter((e) => e.kind === 'result').length;
    if (results >= turns && thread.status !== 'running') return { thread, events: detail.events ?? [] };
    await sleep(2000);
  }
  throw new Error(`thread ${id} did not settle`);
}

// A protobuf wire reader, enough for agy's gen_metadata rows.
function fields(buf) {
  const out = [];
  let i = 0;
  const varint = () => {
    let r = 0n;
    let s = 0n;
    for (;;) {
      const b = buf[i++];
      r |= BigInt(b & 0x7f) << s;
      s += 7n;
      if (!(b & 0x80)) return r;
    }
  };
  while (i < buf.length) {
    const key = Number(varint());
    const wire = key & 7;
    if (wire === 0) out.push([key >> 3, varint()]);
    else if (wire === 2) {
      const n = Number(varint());
      out.push([key >> 3, buf.subarray(i, i + n)]);
      i += n;
    } else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else throw new Error(`wire type ${wire}`);
  }
  return out;
}
const field = (m, f) => m.find(([k]) => k === f)?.[1];
const int = (m, f) => (typeof field(m, f) === 'bigint' ? Number(field(m, f)) : 0);

/** Every model call of one agy conversation: fresh and cached prompt tokens, output and thinking. */
function modelCalls(db) {
  const d = new DatabaseSync(db, { readOnly: true });
  return d.prepare('select data from gen_metadata order by idx').all().map((r) => {
    const meta = fields(field(fields(Buffer.from(r.data)), 1));
    const u = fields(field(meta, 4) ?? Buffer.alloc(0));
    return { fresh: int(u, 2), cached: int(u, 5), output: int(u, 3), thinking: int(u, 9) };
  });
}

const fixture = join(OUT, 'fixture');
for (const [name, text] of Object.entries(FILES)) {
  mkdirSync(join(fixture, name, '..'), { recursive: true });
  writeFileSync(join(fixture, name), text);
}
const channel = `bench-${label}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
await api('POST', '/channels', { id: channel, name: `Bench ${label}`, kind: 'client', base_dir: fixture });
const before = allowance();
const started = Date.now();
const made = await api('POST', '/threads', { channel, role: 'researcher', harness: 'antigravity', model, ...(effort && { effort }), prompt: TURNS[0], title: `bench ${label}` });
let done = await settled(made.id, 1);
for (let i = 1; i < TURNS.length; i++) {
  await api('POST', `/threads/${made.id}/messages`, { prompt: TURNS[i], mode: 'queue' });
  done = await settled(made.id, i + 1);
}
await sleep(4000);
const after = allowance();

const src = HOMES.map((h) => join(h, '.gemini/antigravity-cli/conversations', `${done.thread.session_id}.db`)).find((p) => existsSync(p));
if (!src) throw new Error(`no agy conversation for session ${done.thread.session_id}`);
const copy = join(OUT, `${label}.db`);
for (const ext of ['', '-wal', '-shm']) if (existsSync(src + ext)) copyFileSync(src + ext, copy + ext);
const calls = modelCalls(copy);
const sum = (k) => calls.reduce((a, c) => a + c[k], 0);
const report = {
  label,
  model,
  effort: effort || 'default',
  thread: made.id,
  seconds: Math.round((Date.now() - started) / 1000),
  calls: calls.length,
  first_prompt: calls[0] ? calls[0].fresh + calls[0].cached : 0,
  fresh: sum('fresh'),
  cached: sum('cached'),
  output: sum('output'),
  thinking: sum('thinking'),
  cost: Math.round(WEIGHTS.fresh * sum('fresh') + WEIGHTS.cached * sum('cached') + WEIGHTS.output * sum('output')),
  allowance_used: { five_hour: before['5h'] - after['5h'], weekly: before.weekly - after.weekly },
  answer: done.events.filter((e) => e.kind === 'assistant_text').map((e) => e.payload?.text ?? '').join(''),
  per_call: calls,
};
writeFileSync(join(OUT, `${label}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...report, per_call: calls.map((c) => `${c.fresh}/${c.cached}/${c.output}`).join(' ') }, null, 1));
console.error(`kept in ${OUT}`);
