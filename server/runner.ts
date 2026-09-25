import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, artifactsDir, threadDir, browserOutDir } from './config.ts';
import { channels, events, threads, kv, type Channel, type Thread, type ThreadSource } from './db.ts';
import { getCrew, type CrewRole } from './crew.ts';
import { prepareWorkdir, writeMcpConfig } from './sandbox.ts';
import { secretsEnv } from './secrets.ts';
import { parseEvent, LineSplitter, type Usage } from './stream.ts';
import { publishFeed, publishThread } from './bus.ts';

const omniUrl = () => `http://127.0.0.1:${config.port}`;

// ---------- queue ----------

interface Job {
  threadId: string;
  prompt: string;
  /** Transcript event recorded when the turn starts, so a queued follow-up lands after the reply it waited for. */
  event: { kind: 'user' | 'crew_report'; payload: Record<string, unknown> };
}

const active = new Map<string, ChildProcess>();
const perThread = new Map<string, Job[]>();
const waiting: string[] = []; // thread ids with pending jobs, FIFO
const stopping = new Set<string>(); // stop requested for the current run

function emitThread(id: string) {
  const t = threads.get(id);
  if (t) publishFeed({ type: 'thread', thread: t });
}

function addEvent(threadId: string, kind: string, payload: unknown) {
  const row = events.add(threadId, kind, payload);
  publishThread(threadId, row);
  return row;
}

function enqueue(job: Job) {
  const list = perThread.get(job.threadId) ?? [];
  list.push(job);
  perThread.set(job.threadId, list);
  if (!active.has(job.threadId) && !waiting.includes(job.threadId)) waiting.push(job.threadId);
  if (!active.has(job.threadId)) threads.update(job.threadId, { status: 'queued' });
  emitThread(job.threadId);
  pump();
}

function pump() {
  while (active.size < config.maxConcurrent && waiting.length) {
    const id = waiting.shift()!;
    const job = perThread.get(id)?.shift();
    if (!job) continue;
    addEvent(job.threadId, job.event.kind, job.event.payload);
    execute(job).catch((err) => {
      // Never let one broken thread take the whole server down.
      console.error(`[runner] ${job.threadId} crashed:`, err);
      addEvent(job.threadId, 'error', { text: `Omni failed to run this thread: ${(err as Error).message}` });
      threads.update(job.threadId, { status: 'failed' });
      emitThread(job.threadId);
      if (active.has(job.threadId)) finished(job.threadId);
    });
  }
}

function finished(threadId: string) {
  active.delete(threadId);
  if (perThread.get(threadId)?.length) waiting.push(threadId);
  else perThread.delete(threadId);
  pump();
}

export const runningCount = () => active.size;
export const queuedCount = () => waiting.length;

/** Messages waiting for the current turn to end. Not yet in the transcript. */
export const pendingFor = (threadId: string) =>
  (perThread.get(threadId) ?? []).map((j) => ({ kind: j.event.kind, ...j.event.payload }));

// ---------- prompts ----------

export function buildSystemPrompt(thread: Thread, channel: Channel, role?: CrewRole) {
  const lines = [
    '# Omni OS context',
    `You are running headless inside Omni OS, Ben's local agent workspace. Nobody can answer permission prompts, so finish the task or clearly state what is blocking you.`,
    `- Thread: ${thread.id}${thread.task_id ? ` (task ${thread.task_id})` : ''}`,
    `- Channel: #${channel.id} (${channel.name}, ${channel.kind})`,
    channel.store_domain ? `- Shopify store: ${channel.store_domain}` : '',
    channel.portal_slug ? `- Ask Phill Portal company slug: ${channel.portal_slug}` : '',
    channel.github_repo ? `- GitHub repo: ${channel.github_repo}` : '',
    thread.branch ? `- You are in a dedicated git worktree on branch ${thread.branch}. Commit here; open a PR when asked.` : '',
    channel.notes ? `- Channel notes: ${channel.notes}` : '',
    '',
    '## Artifacts',
    `Write any HTML page, report, diagram, CSV or document meant for Ben into ${artifactsDir(thread.id)} (env OMNI_ARTIFACTS_DIR).`,
    'Omni renders files there inline in the thread. Prefer a self-contained .html file for anything visual. Mention the filename in your reply.',
    '',
    '## Browser',
    config.browser
      ? `The "omni-browser" MCP is this thread's browser. It keeps this channel's logins between threads. Screenshots land in ${browserOutDir(thread.id)} and show up in the thread.`
      : '',
    '',
    '## Secrets',
    'Channel and global secrets are already in your environment as variables. Never print, echo or write their values anywhere.',
    '',
    '## Reply',
    'Your final message is what gets shown and reported. Lead with the outcome, keep it short, bullets over prose.',
  ];
  if (thread.parent_id) {
    lines.push(
      '',
      '## Delegated task',
      `The conductor handed you this task${thread.task_id ? ` as ${thread.task_id}` : ''}. Your final message is automatically reported back to it. Report outcomes and blockers, even if the answer is "nothing found".`,
    );
  }
  if (role) lines.push('', `## Your role: ${role.name}`, role.charter);
  return lines.filter((l) => l !== '').join('\n').replace(/\n## /g, '\n\n## ');
}

// ---------- execution ----------

async function execute(job: Job) {
  const thread = threads.get(job.threadId);
  if (!thread) return finished(job.threadId);
  const channel = channels.get(thread.channel_id)!;
  const role = getCrew(thread.role);
  const placeholder = spawnPlaceholder();
  active.set(thread.id, placeholder);

  threads.update(thread.id, { status: 'running' });
  emitThread(thread.id);

  const browserBusy = threads
    .running()
    .some((t) => t.id !== thread.id && t.channel_id === channel.id && t.status === 'running');
  const mcpFile = writeMcpConfig({ threadId: thread.id, channel, role, browserBusy, omniUrl: omniUrl() });

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', thread.model || role?.model || config.defaultModel,
    '--permission-mode', config.permissionMode,
    '--add-dir', threadDir(thread.id),
    '--append-system-prompt', buildSystemPrompt(thread, channel, role),
  ];
  if (thread.cwd !== config.brainDir) args.push('--add-dir', config.brainDir);
  if (mcpFile) args.push('--mcp-config', mcpFile);
  args.push(thread.has_run || sessionOnDisk(thread) ? '--resume' : '--session-id', thread.session_id);

  let secretEnv: Record<string, string> = {};
  try {
    secretEnv = await secretsEnv(channel.id);
  } catch (err) {
    addEvent(thread.id, 'error', { text: `Could not read secrets: ${(err as Error).message}` });
  }

  if (stopping.has(thread.id)) {
    // Stopped while secrets or the worktree were being prepared.
    stopping.delete(thread.id);
    threads.update(thread.id, { status: 'stopped' });
    emitThread(thread.id);
    return finished(thread.id);
  }

  const child = spawn(config.claudeBin, args, {
    cwd: thread.cwd,
    env: {
      ...process.env,
      ...secretEnv,
      CLAUDE_CODE_ENTRYPOINT: 'omni-os',
      CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
      OMNI_URL: omniUrl(),
      OMNI_THREAD_ID: thread.id,
      OMNI_THREAD_DIR: threadDir(thread.id),
      OMNI_ARTIFACTS_DIR: artifactsDir(thread.id),
      OMNI_CHANNEL: channel.id,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  active.set(thread.id, child);
  // Prompt via stdin so leading dashes or huge pastes never get parsed as flags.
  child.stdin.end(job.prompt);

  const splitter = new LineSplitter();
  let stderr = '';
  let gotResult = false;
  let resultOk = false;

  const handleLine = (line: string) => {
    let evt: unknown;
    try {
      evt = JSON.parse(line);
    } catch {
      return;
    }
    const parsed = parseEvent(evt);
    if (parsed.usage) {
      kv.set('usage', parsed.usage);
      publishFeed({ type: 'usage', usage: parsed.usage });
    }
    for (const rec of parsed.records) {
      if (rec.kind === 'result') {
        gotResult = true;
        resultOk = rec.payload.ok;
        // On resume the CLI can flush a leftover background task as an empty zero-turn result. Not a turn.
        if (rec.payload.ok && !rec.payload.turns) continue;
        // The result text duplicates the last assistant message; keep only the metadata.
        addEvent(thread.id, 'result', { ...rec.payload, text: undefined, stopped: stopping.has(thread.id) || undefined });
      } else {
        addEvent(thread.id, rec.kind, rec.payload);
      }
    }
  };

  // setEncoding keeps multibyte characters intact when they straddle two chunks.
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d: string) => splitter.push(d).forEach(handleLine));
  child.stderr.on('data', (d: string) => (stderr = (stderr + d).slice(-8000)));

  child.on('error', (err) => {
    addEvent(thread.id, 'error', { text: `Could not start claude: ${err.message}` });
  });

  child.on('close', (code, signal) => {
    splitter.flush().forEach(handleLine);
    // The CLI traps SIGINT and exits normally, so rely on our own flag, not the signal.
    const stopped = stopping.delete(thread.id) || signal === 'SIGINT' || signal === 'SIGTERM' || signal === 'SIGKILL';
    // Once the CLI has written the session file, later messages must --resume it.
    const sessionCreated = gotResult || thread.has_run === 1;
    if (!gotResult && !stopped) {
      addEvent(thread.id, 'error', { text: `claude exited with code ${code}.\n${stderr.trim().slice(-2000)}` });
    }
    const status = stopped ? 'stopped' : gotResult && resultOk ? 'done' : 'failed';
    const runText = events.lastRunText(thread.id);
    threads.update(thread.id, {
      status: perThread.get(thread.id)?.length ? 'queued' : status,
      has_run: sessionCreated ? 1 : 0,
      last_text: runText ? runText.slice(0, 600) : threads.get(thread.id)?.last_text ?? null,
    });
    emitThread(thread.id);
    if (thread.parent_id && !stopped) reportToParent(thread.id, status, runText);
    finished(thread.id);
  });
}

// A run killed before its result event may still have written the session file.
function sessionOnDisk(t: Thread) {
  const dir = join(homedir(), '.claude', 'projects', t.cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  return existsSync(join(dir, `${t.session_id}.jsonl`));
}

// A stand-in so the concurrency slot is held while secrets and worktrees are prepared.
function spawnPlaceholder(): ChildProcess {
  return { kill: () => true } as unknown as ChildProcess;
}

function reportToParent(childId: string, status: string, text: string) {
  const child = threads.get(childId)!;
  const parent = threads.get(child.parent_id!);
  if (!parent) return;
  const report = {
    text: text || '(no reply)',
    task_id: child.task_id,
    thread_id: child.id,
    title: child.title,
    role: child.role,
    channel: child.channel_id,
    status,
  };
  // Wake the parent so it can relay the outcome, exactly like a crewmate messaging firstmate.
  enqueue({
    threadId: parent.id,
    event: { kind: 'crew_report', payload: report },
    prompt:
      `[crew report] task ${child.task_id ?? '(none)'} from ${child.role ?? 'crew'} in #${child.channel_id} ` +
      `(thread ${child.id}), status: ${status}\n\n${report.text}\n\n` +
      'Relay what matters to Ben in one short update. Delegate follow-ups if needed. Do not redo the work.',
  });
}

// ---------- public API ----------

export interface CreateThreadInput {
  channel: string;
  prompt: string;
  role?: string | null;
  model?: string | null;
  title?: string | null;
  parent_id?: string | null;
  task_id?: string | null;
  source?: ThreadSource;
  automation?: string | null;
}

export async function createThread(input: CreateThreadInput): Promise<Thread> {
  const role = getCrew(input.role);
  const channelId = input.channel || role?.channel || 'inbox';
  const channel = channels.get(channelId);
  if (!channel) throw new Error(`unknown channel "${channelId}"`);
  const id = randomUUID();
  const wd = await prepareWorkdir(channel, id);
  const thread = threads.create({
    id,
    channel_id: channel.id,
    title: input.title?.trim() || fallbackTitle(input.prompt),
    status: 'queued',
    role: role?.id ?? null,
    model: input.model || null,
    session_id: id,
    cwd: wd.cwd,
    branch: wd.branch,
    parent_id: input.parent_id ?? null,
    task_id: input.task_id ?? (input.parent_id ? `T-${id.slice(0, 4).toUpperCase()}` : null),
    source: input.source ?? 'manual',
    automation: input.automation ?? null,
  });
  enqueue({ threadId: thread.id, prompt: input.prompt, event: { kind: 'user', payload: { text: input.prompt, source: thread.source } } });
  if (!input.title) void generateTitle(thread.id, input.prompt);
  return threads.get(thread.id)!;
}

export function sendMessage(threadId: string, prompt: string, from: 'ben' | 'conductor' = 'ben') {
  const thread = threads.get(threadId);
  if (!thread) throw new Error('thread not found');
  enqueue({ threadId, prompt, event: { kind: 'user', payload: { text: prompt, source: from } } });
  return threads.get(threadId)!;
}

export function stopThread(threadId: string) {
  perThread.delete(threadId);
  const idx = waiting.indexOf(threadId);
  if (idx >= 0) waiting.splice(idx, 1);
  const child = active.get(threadId);
  if (child) {
    stopping.add(threadId);
    child.kill('SIGINT');
    setTimeout(() => active.get(threadId) === child && child.kill('SIGKILL'), 5000);
  } else {
    threads.update(threadId, { status: 'stopped' });
    emitThread(threadId);
  }
}

export const getUsage = () => kv.get<Usage>('usage') ?? null;

function fallbackTitle(prompt: string) {
  const first = prompt.trim().split('\n')[0].replace(/\s+/g, ' ');
  return first.length > 70 ? first.slice(0, 67) + '...' : first || 'Untitled';
}

function generateTitle(threadId: string, prompt: string) {
  const child = spawn(
    config.claudeBin,
    ['-p', '--model', 'haiku', '--output-format', 'text', '--strict-mcp-config', '--no-session-persistence', '--tools', ''],
    { cwd: tmpdir(), env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'omni-os-title' }, stdio: ['pipe', 'pipe', 'ignore'] },
  );
  child.stdin.end(
    'Write a title of at most 7 words for this task. Plain text, no quotes, no trailing period, no em dashes. ' +
      'Output the title only.\n\nTask:\n' + prompt.slice(0, 3000),
  );
  let out = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
  child.stdout.on('data', (d) => (out += d));
  child.on('close', (code) => {
    clearTimeout(timer);
    const title = out.trim().split('\n').filter(Boolean).pop()?.replace(/^["']|["']$/g, '').slice(0, 90);
    if (code === 0 && title) {
      threads.update(threadId, { title, updated_at: threads.get(threadId)?.updated_at });
      emitThread(threadId);
    }
  });
  child.on('error', () => clearTimeout(timer));
}
