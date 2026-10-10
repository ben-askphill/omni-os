#!/usr/bin/env node
// Test stand-in for `codex app-server`, speaking the codex-cli 0.157 shapes Omni depends on
// (server/harness/codex/protocol.ts). Like the real one it rejects a request without `params`,
// a sandbox that is not a mode string, and a steer when no turn is running. One process per
// thread, kept warm.
//
// Requests answered: initialize, account/read, account/rateLimits/read, config/read,
// model/list (two models a page), skills/list, thread/start, thread/resume, turn/start,
// turn/steer, turn/interrupt, review/start, thread/compact/start. A turn sends turn/started,
// item/started and item/completed (userMessage, commandExecution, agentMessage),
// account/rateLimits/updated (on the first turn, for the plan's bucket and then a reserve
// model's) and turn/completed.
//
// An inline review goes as codex-cli 0.157's did (tests/fixtures/codex-review.jsonl): the answer
// carries the review's turn, enteredReviewMode, a turn/started under a second turn id, the
// review prompt as a userMessage, exitedReviewMode with the review, the same text again as an
// agentMessage, then turn/completed for the review's turn. A compaction answers `{}`, then runs
// as a turn of its own with a contextCompaction item. Neither can be steered, as in Codex.
//
// Directives in a turn's input text:
//   CMD       run a shell command (a commandExecution item) before the reply
//   PLAN      update the checklist (turn/plan/updated) before the reply
//   SLOW      take 400 ms before replying
//   HANG      never finish on its own; only turn/interrupt ends the turn
//   RETRY     report an error Codex retries by itself, then carry on
//   BADTURN   fail the turn on the plan limit, with the API's JSON error body as the message
//   CRASH     exit(1) mid-turn, like the process dying
//   SKILLS_EDITED  send skills/changed, as Codex does when a personal skill file changes
// and in a review's custom instructions:
//   HANG      never finish on its own; only turn/interrupt ends the review
// Env:
//   FAKE_CODEX_LOG=<file>     append one JSON line per request (method, params, cwd, api vars seen)
//   FAKE_CODEX_ACCOUNT=none   logged out; =apiKey logged in with an API key instead of ChatGPT
//   FAKE_CODEX_SKILLS_FAIL=1  skills/list answers with an error
//   CODEX_HOME=<dir>          personal skills are read from <dir>/skills, as Codex does
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
if (argv[0] !== 'app-server') {
  process.stderr.write(`fake-codex: only "app-server" is emulated (got ${argv.join(' ')})\n`);
  process.exit(1);
}

const LOG = process.env.FAKE_CODEX_LOG || null;
const API_VARS = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL'];
const log = (method, params) => {
  if (!LOG) return;
  appendFileSync(
    LOG,
    JSON.stringify({
      pid: process.pid,
      time: Date.now(),
      method,
      params: params ?? null,
      cwd: process.cwd(),
      thread_id: process.env.OMNI_THREAD_ID ?? null,
      api_auth: API_VARS.filter((k) => k in process.env),
      // Names only (never values) of the probe env vars the process can see, for the secrets test.
      env_probe: Object.keys(process.env).filter((k) => k.startsWith('PROBE_')),
    }) + '\n',
  );
};

const write = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const respond = (id, result) => write({ id, result });
const fail = (id, message) => write({ id, error: { code: -32600, message } });
const notify = (method, params) => write({ method, params });

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.stdout.on('error', () => process.exit(0));

// ---------- the account and the catalog ----------

const ACCOUNTS = {
  chatgpt: { type: 'chatgpt', email: 'dev@example.com', planType: 'plus' },
  apiKey: { type: 'apiKey' },
  none: null,
};

const model = (id, displayName, efforts, defaultReasoningEffort, extra = {}) => ({
  id,
  model: id,
  displayName,
  description: '',
  hidden: false,
  supportedReasoningEfforts: efforts.map((e) => ({ reasoningEffort: e, description: `${e} reasoning` })),
  defaultReasoningEffort,
  isDefault: false,
  ...extra,
});
// Codex's own default first; the reserve model is one Codex's own picker hides.
const MODELS = [
  model('gpt-6-astra', 'GPT-6 Astra', ['low', 'medium', 'high', 'xhigh', 'ultra'], 'low', { isDefault: true }),
  model('gpt-5.6-sol', 'GPT-5.6 Sol', ['low', 'medium', 'high', 'xhigh'], 'low'),
  model('gpt-reserve', 'GPT Reserve', ['low', 'medium'], 'low', { hidden: true }),
  model('gpt-5.6-terra', 'GPT-5.6 Terra', ['low', 'medium', 'high'], 'medium'),
];

// config.toml, as config/read reports it.
const CONFIG = { model: 'gpt-5.6-sol', model_reasoning_effort: 'high' };

const win = (usedPercent, windowDurationMins, resetsAt) => ({ usedPercent, windowDurationMins, resetsAt });
const bucket = (limitId, primary, secondary) => ({
  limitId,
  limitName: null,
  normalModelSlug: null,
  primary,
  secondary,
  credits: null,
  individualLimit: null,
  spendControlReached: null,
  planType: 'plus',
  rateLimitReachedType: null,
});
// The plan's 5-hour and weekly windows; the reserve model's weekly bucket is not the plan.
const planLimits = (fiveHour, week) => bucket('codex', win(fiveHour, 300, 1790328600), win(week, 10080, 1790922600));
const RESERVE_LIMITS = bucket('base_model_inference', null, win(90, 10080, 1790922600));

// ---------- skills ----------

// Skills from folders, then the ones every folder gets. The repeat of `tdd` is a second copy
// Codex also lists; the first one wins.
const skill = (name, description, scope, path, extra = {}) => ({ name, description, path, scope, enabled: true, pluginId: null, ...extra });
const FIXED_SKILLS = [
  skill('tdd', 'Test-driven development with red-green-refactor loop.', 'user', '/Users/dev/.agents/skills/tdd/SKILL.md'),
  skill('bro', 'Restate the last message in plain human language.', 'user', '/Users/dev/.agents/skills/bro/SKILL.md'),
  skill('tdd', 'An older copy.', 'user', '/Users/dev/.agents/skills/synced/tdd/SKILL.md'),
  skill('vercel:vercel-cli', 'Vercel CLI expert guidance.', 'user', '/Users/dev/.codex/plugins/cache/vercel/skills/vercel-cli/SKILL.md', { pluginId: 'vercel@claude-plugins-official' }),
  skill('legacy-deploy', 'Deploy with the old pipeline.', 'user', '/Users/dev/.agents/skills/legacy-deploy/SKILL.md', { enabled: false }),
  skill('imagegen', 'Generate or edit raster images when the task benefits from AI-created bitmap visuals.', 'system', '/Users/dev/.codex/skills/.system/imagegen/SKILL.md', {
    interface: { displayName: 'Image Gen', shortDescription: 'Generate or edit images for websites, games, and more' },
  }),
];

/** The skills in `<dir>/<name>/SKILL.md`, named and described by their frontmatter. */
function skillsIn(dir, scope) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => existsSync(join(dir, d, 'SKILL.md')))
    .map((d) => {
      const file = join(dir, d, 'SKILL.md');
      const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, 'utf8'))?.[1] ?? '';
      const field = (k) => new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(front)?.[1]?.trim() ?? '';
      return skill(field('name') || d, field('description'), scope, file);
    });
}

const skillsFor = (cwd) => [
  ...skillsIn(join(cwd, '.agents', 'skills'), 'repo'),
  ...(process.env.CODEX_HOME ? skillsIn(join(process.env.CODEX_HOME, 'skills'), 'user') : []),
  ...FIXED_SKILLS,
];

const PLAN = [
  { step: 'Scaffold', status: 'completed' },
  { step: 'Wire adapter', status: 'inProgress' },
  { step: 'Test', status: 'pending' },
];

// ---------- threads and turns ----------

// Every method under these prefixes rejects a request without `params`.
const NEEDS_PARAMS = /^(account|config|model|thread|turn)\//;
const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'];

let threadId = null;
let turnSeq = 0;
let itemSeq = 0;
let rateLimitsSent = false;
let activeTurn = null;
let dead = false;

const nextItemId = () => `item_${++itemSeq}`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const textOf = (input) => (Array.isArray(input) ? input.filter((i) => i?.type === 'text').map((i) => i.text ?? '').join('\n') : '');
const turnError = (message, codexErrorInfo = 'other') => ({ message, codexErrorInfo, additionalDetails: null, misalignment: null });
const turnOf = (t) => ({
  id: t.id,
  items: [],
  itemsView: 'notLoaded',
  status: t.status,
  error: t.error,
  startedAt: null,
  completedAt: null,
  durationMs: null,
});
const item = (turn, it, phase) => notify(`item/${phase}`, { item: it, threadId, turnId: turn.id, [`${phase}AtMs`]: Date.now() });
const message = (text) => ({ type: 'agentMessage', id: nextItemId(), text, phase: 'final_answer', memoryCitation: null, delivery: null, questions: null });

// The context in use after each turn, as thread/tokenUsage/updated reports it: 2K more a turn, 5K after a compaction.
let contextTokens = 30_000;

function end(turn, status, error = null) {
  if (turn.status !== 'inProgress') return;
  turn.status = status;
  turn.error = error;
  if (activeTurn === turn) activeTurn = null;
  if (status === 'completed') {
    contextTokens = turn.kind === 'compact' ? 5_000 : contextTokens + 2_000;
    const last = { totalTokens: contextTokens, inputTokens: contextTokens - 500, cachedInputTokens: 0, outputTokens: 500, reasoningOutputTokens: 0 };
    notify('thread/tokenUsage/updated', { threadId, turnId: turn.id, tokenUsage: { total: last, last, modelContextWindow: 272_000 } });
  }
  notify('turn/completed', { threadId, turn: turnOf(turn) });
}

async function runTurn(turn, input) {
  const said = textOf(input);
  notify('turn/started', { threadId, turn: turnOf(turn) });
  // The input comes back as a userMessage item.
  const user = { type: 'userMessage', id: nextItemId(), clientId: null, content: input };
  item(turn, user, 'started');
  item(turn, user, 'completed');
  await delay(5);
  if (said.includes('SLOW')) await delay(400);
  if (turn.status !== 'inProgress') return;
  if (said.includes('CRASH')) {
    process.stderr.write('fake-codex: crashing on purpose\n');
    process.exit(1);
  }
  if (said.includes('RETRY')) {
    notify('error', { error: turnError('Reconnecting... 1/5'), willRetry: true, threadId, turnId: turn.id });
  }
  if (said.includes('PLAN')) notify('turn/plan/updated', { threadId, turnId: turn.id, explanation: null, plan: PLAN });
  if (said.includes('SKILLS_EDITED')) notify('skills/changed', {});
  if (said.includes('CMD')) {
    const cmd = {
      type: 'commandExecution',
      id: nextItemId(),
      pluginId: null,
      scriptPath: null,
      command: "/bin/zsh -lc 'echo hi'",
      cwd: process.cwd(),
      processId: '4242',
      source: 'unifiedExecStartup',
      status: 'inProgress',
      commandActions: [{ type: 'unknown', command: 'echo hi' }],
      aggregatedOutput: null,
      exitCode: null,
      durationMs: null,
    };
    item(turn, cmd, 'started');
    await delay(5);
    item(turn, { ...cmd, status: 'completed', aggregatedOutput: 'hi\n', exitCode: 0, durationMs: 3 }, 'completed');
  }
  if (!rateLimitsSent) {
    rateLimitsSent = true;
    notify('account/rateLimits/updated', { rateLimits: planLimits(12, 3) });
    notify('account/rateLimits/updated', { rateLimits: RESERVE_LIMITS });
  }
  if (said.includes('BADTURN')) {
    const body = { type: 'error', status: 429, error: { type: 'usage_limit_reached', message: "You've hit your usage limit. It resets at 5:00 PM." } };
    const error = turnError(JSON.stringify(body), 'usageLimitExceeded');
    notify('error', { error, willRetry: false, threadId, turnId: turn.id });
    return end(turn, 'failed', error);
  }
  // Never completes on its own: the turn hangs until interrupted.
  if (said.includes('HANG')) return;
  await delay(5);
  if (turn.status !== 'inProgress') return;
  const reply = message(`ack: ${said}`);
  item(turn, { ...reply, text: '' }, 'started');
  item(turn, reply, 'completed');
  await delay(5);
  end(turn, 'completed');
}

function openThread(id, method, params) {
  if (params.sandbox != null && !SANDBOX_MODES.includes(params.sandbox)) {
    return fail(id, `Invalid request: unknown variant ${JSON.stringify(params.sandbox)}, expected one of ${SANDBOX_MODES.join(', ')}`);
  }
  if (params.config != null && (typeof params.config !== 'object' || Array.isArray(params.config))) {
    return fail(id, 'Invalid request: `config` must be a table of config.toml keys');
  }
  if (method === 'thread/resume') {
    if (!String(params.threadId ?? '').startsWith('th_')) return fail(id, `no rollout found for thread id ${params.threadId}`);
    threadId = params.threadId;
  } else {
    threadId = `th_${randomUUID().slice(0, 8)}`;
  }
  const cwd = params.cwd ?? process.cwd();
  const modelId = params.model ?? CONFIG.model;
  respond(id, {
    thread: { id: threadId, sessionId: threadId, preview: '', ephemeral: false, modelProvider: 'openai', model: modelId, cwd, turns: [] },
    model: modelId,
    modelProvider: 'openai',
    serviceTier: null,
    disabledPluginIds: [],
    cwd,
    instructionSources: [],
    approvalPolicy: params.approvalPolicy ?? 'on-request',
    approvalsReviewer: 'user',
    sandbox: { type: params.sandbox === 'danger-full-access' ? 'dangerFullAccess' : 'workspaceWrite' },
    reasoningEffort: CONFIG.model_reasoning_effort,
  });
}

function startTurn(id, params) {
  if (!threadId || params.threadId !== threadId) return fail(id, `thread not found: ${params.threadId}`);
  if (!Array.isArray(params.input)) return fail(id, 'Invalid request: missing field `input`');
  if (activeTurn) return fail(id, `turn ${activeTurn.id} is still running`);
  const turn = (activeTurn = { id: `turn_${++turnSeq}`, status: 'inProgress', error: null });
  // The answer comes before turn/started.
  respond(id, { turn: turnOf(turn) });
  void runTurn(turn, params.input);
}

function steer(id, params) {
  const turn = activeTurn;
  if (!turn || params.threadId !== threadId) return fail(id, 'no active turn to steer');
  if (params.expectedTurnId !== turn.id) return fail(id, `expected turn ${params.expectedTurnId}, but turn ${turn.id} is running`);
  if (turn.kind) return fail(id, `ActiveTurnNotSteerable: a ${turn.kind} turn cannot be steered`);
  if (!Array.isArray(params.input)) return fail(id, 'Invalid request: missing field `input`');
  respond(id, { turnId: turn.id });
  // The steer joins the running turn (no new turn/started), and the model answers it.
  item(turn, { type: 'userMessage', id: nextItemId(), clientId: null, content: params.input }, 'completed');
  item(turn, message(`steered: ${textOf(params.input)}`), 'completed');
}

/** What a review looks at, in Codex's words: its status hint and the review turn's user message. */
function reviewHint(target) {
  switch (target?.type) {
    case 'uncommittedChanges':
      return 'current changes';
    case 'baseBranch':
      return target.branch ? `changes against '${target.branch}'` : null;
    case 'commit':
      return target.sha ? `commit ${String(target.sha).slice(0, 7)}${target.title ? `: ${target.title}` : ''}` : null;
    case 'custom':
      return String(target.instructions ?? '').trim() || null;
    default:
      return null;
  }
}

function startReview(id, params) {
  if (!threadId || params.threadId !== threadId) return fail(id, `thread not found: ${params.threadId}`);
  const hint = reviewHint(params.target);
  if (!hint) return fail(id, `Invalid request: bad review target ${JSON.stringify(params.target)}`);
  if (params.delivery != null && !['inline', 'detached'].includes(params.delivery)) return fail(id, `Invalid request: unknown delivery ${params.delivery}`);
  if (activeTurn) return fail(id, `turn ${activeTurn.id} is still running`);
  const turn = (activeTurn = { id: `turn_${++turnSeq}`, status: 'inProgress', error: null, kind: 'review' });
  const asked = { type: 'userMessage', id: turn.id, clientId: null, content: [{ type: 'text', text: hint, text_elements: [] }] };
  respond(id, { turn: { ...turnOf(turn), items: [asked] }, reviewThreadId: threadId });
  void runReview(turn, hint);
}

async function runReview(turn, hint) {
  const entered = { type: 'enteredReviewMode', id: nextItemId(), review: hint };
  item(turn, entered, 'started');
  item(turn, entered, 'completed');
  // Announced under an id of its own; everything after carries the review turn's id.
  notify('turn/started', { threadId, turn: turnOf({ id: `turn_${++turnSeq}`, status: 'inProgress', error: null }) });
  const prompt = { type: 'userMessage', id: nextItemId(), clientId: null, content: [{ type: 'text', text: `Review the ${hint} and provide prioritized findings.`, text_elements: [] }] };
  item(turn, prompt, 'started');
  item(turn, prompt, 'completed');
  await delay(5);
  if (hint.includes('HANG') || turn.status !== 'inProgress') return;
  // The reviewer's own answer starts and never completes.
  item(turn, message(''), 'started');
  const review = `Review of ${hint}: no issues found.`;
  const exited = { type: 'exitedReviewMode', id: nextItemId(), review };
  item(turn, exited, 'started');
  item(turn, exited, 'completed');
  const reply = { ...message(review), phase: null };
  item(turn, reply, 'started');
  item(turn, reply, 'completed');
  await delay(5);
  end(turn, 'completed');
}

function compact(id, params) {
  if (!threadId || params.threadId !== threadId) return fail(id, `thread not found: ${params.threadId}`);
  if (activeTurn) return fail(id, `turn ${activeTurn.id} is still running`);
  const turn = (activeTurn = { id: `turn_${++turnSeq}`, status: 'inProgress', error: null, kind: 'compact' });
  respond(id, {});
  void runCompaction(turn);
}

async function runCompaction(turn) {
  await delay(5);
  notify('turn/started', { threadId, turn: turnOf(turn) });
  const it = { type: 'contextCompaction', id: nextItemId() };
  item(turn, it, 'started');
  await delay(20);
  if (turn.status !== 'inProgress') return;
  item(turn, it, 'completed');
  end(turn, 'completed');
}

function interrupt(id, params) {
  const turn = activeTurn;
  if (!turn || params.threadId !== threadId || params.turnId !== turn.id) return fail(id, 'no active turn to interrupt');
  respond(id, {});
  end(turn, 'interrupted');
}

function onMessage(msg) {
  if (dead) return;
  const { id, method, params } = msg;
  if (method === undefined) return; // a response; the client never sends those
  log(method, params);
  if (NEEDS_PARAMS.test(method) && (params == null || typeof params !== 'object')) {
    return fail(id, 'Invalid request: missing field `params`');
  }
  switch (method) {
    case 'initialize':
      return respond(id, { userAgent: 'fake-codex/0.157.0', codexHome: '/tmp/fake-codex-home', platformFamily: 'unix', platformOs: 'macos' });
    case 'initialized':
      return; // notification
    case 'account/read':
      return respond(id, { account: ACCOUNTS[process.env.FAKE_CODEX_ACCOUNT || 'chatgpt'], requiresOpenaiAuth: true });
    case 'account/rateLimits/read': {
      const plan = planLimits(8, 2);
      return respond(id, {
        ordinaryUsageAllowed: true,
        rateLimits: plan,
        rateLimitsByLimitId: { codex: plan, base_model_inference: RESERVE_LIMITS },
        rateLimitResetCredits: null,
        accountId: null,
        rateLimitUpsell: null,
      });
    }
    case 'config/read':
      return respond(id, { config: { ...CONFIG }, origins: {}, layers: null });
    case 'model/list': {
      const all = MODELS.filter((m) => params.includeHidden || !m.hidden);
      const from = Number(params.cursor ?? 0);
      const to = from + (params.limit ?? 2);
      return respond(id, { data: all.slice(from, to), nextCursor: to < all.length ? String(to) : null });
    }
    case 'skills/list':
      if (process.env.FAKE_CODEX_SKILLS_FAIL) return fail(id, 'skills are unavailable');
      return respond(id, { data: (params?.cwds ?? []).map((cwd) => ({ cwd, skills: skillsFor(cwd), errors: [] })) });
    case 'thread/start':
    case 'thread/resume':
      return openThread(id, method, params);
    case 'turn/start':
      return startTurn(id, params);
    case 'turn/steer':
      return steer(id, params);
    case 'turn/interrupt':
      return interrupt(id, params);
    case 'review/start':
      return startReview(id, params ?? {});
    case 'thread/compact/start':
      return compact(id, params);
    default:
      if (typeof id === 'number') respond(id, {});
      return;
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      onMessage(JSON.parse(line));
    } catch {
      /* ignore malformed input */
    }
  }
});
process.stdin.on('end', () => {
  dead = true;
  process.exit(0);
});
