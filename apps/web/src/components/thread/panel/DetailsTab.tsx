import { useState, type ReactNode } from 'react';
import type { Channel, Thread } from '../../../api.ts';
import { HarnessMark } from '../../brand.tsx';
import { Chip, CopyButton, StatusDot } from '../../ui.tsx';
import { duration, fullDate, plural } from '../../../format.ts';
import { href } from '../../../router.ts';

export interface InitP {
  model?: string;
  cwd?: string;
  tools?: number;
  mcp?: string[];
}
export interface ResultP {
  duration_ms?: number;
  turns?: number;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
}

const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

function McpList({ servers }: { servers: string[] }) {
  const [open, setOpen] = useState(false);
  const parsed = servers.map((m) => {
    const cut = m.lastIndexOf(':');
    const name = cut > 0 ? m.slice(0, cut) : m;
    const status = cut > 0 ? m.slice(cut + 1) : '';
    const label = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(name) ? `${name.slice(0, 8)}…` : name;
    return { key: m, name, status, label, ok: !status || status === 'connected' };
  });
  const bad = parsed.filter((p) => !p.ok);
  const good = parsed.filter((p) => p.ok);
  return (
    <div>
      <div className="text-fg-2">
        {good.length} connected
        {bad.length > 0 && <span className="text-fg-2"> · {bad.length} not connected</span>}
        <button type="button" onClick={() => setOpen((v) => !v)} className="ml-2 text-[12px] text-fg-3 underline-offset-2 hover:text-fg hover:underline">
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {bad.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {bad.map((p) => (
            <Chip key={p.key} tone="needs" title={`${p.name} (${p.status})`}>
              {p.label}
            </Chip>
          ))}
        </div>
      )}
      {open && (
        <div className="mt-1 flex flex-wrap gap-1">
          {good.map((p) => (
            <Chip key={p.key} title={p.name}>
              {p.label}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 px-3.5 py-2 text-[12.5px]">
      <dt className="pt-px text-fg-3">{k}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}

export function DetailsTab({
  thread,
  channel,
  parent,
  children,
  init,
  lastResult,
  warm,
}: {
  thread: Thread;
  channel: Channel | undefined;
  parent: Thread | null;
  children: Thread[];
  init: InitP | null;
  lastResult: ResultP | null;
  warm: boolean | undefined;
}) {
  const cwd = init?.cwd || thread.cwd;
  const remote = thread.harness === 'hermes';
  const resumeCmd: Record<string, string> = {
    'claude-code': `claude --resume ${thread.session_id}`,
    codex: `codex resume ${thread.session_id}`,
    cursor: `cursor-agent --resume ${thread.session_id}`,
  };
  const resume = remote ? '' : `cd ${shellQuote(cwd)} && ${resumeCmd[thread.harness] ?? resumeCmd['claude-code']}`;
  return (
    <div className="scroll-thin h-full overflow-y-auto px-2.5 pb-3">
      <dl className="divide-y divide-line rounded-[20px] bg-bg py-1">
        <Row k="Channel">
          <a href={href.channel(thread.channel_id)} className="font-medium hover:underline">
            #{channel?.name ?? thread.channel_id}
          </a>
        </Row>
        <Row k="Role">{thread.role ?? <span className="text-fg-3">none</span>}</Row>
        <Row k="Harness">
          <HarnessMark harness={thread.harness} withLabel />
        </Row>
        <Row k="Model">
          {thread.model || init?.model || <span className="text-fg-3">default</span>}
          {thread.model && init?.model && init.model !== thread.model && <span className="ml-1 text-fg-3">({init.model})</span>}
        </Row>
        <Row k="Effort">{thread.effort || <span className="text-fg-3">default</span>}</Row>
        <Row k="Source">
          {thread.source}
          {thread.automation && <span className="text-fg-3"> · {thread.automation}</span>}
        </Row>
        {thread.branch && (
          <Row k="Branch">
            <span className="font-mono text-[12px]">{thread.branch}</span>
          </Row>
        )}
        <Row k="Working dir">
          {remote ? (
            <span className="text-fg-3">Hermes server, not an Omni worktree</span>
          ) : (
            <span className="font-mono text-[12px]">{cwd}</span>
          )}
        </Row>
        <Row k="Session">
          <span className="font-mono text-[12px]">{thread.session_id}</span>
          {warm !== undefined && (
            <div className="mt-0.5 flex items-center gap-1.5 text-fg-3">
              <StatusDot status={warm ? 'done' : 'imported'} size={6} />
              {warm ? 'Live, the next message starts instantly' : 'Not running, the next message starts a new process'}
            </div>
          )}
        </Row>
        {thread.task_id && (
          <Row k="Task">
            <span className="font-mono text-[12px]">{thread.task_id}</span>
          </Row>
        )}
        {parent && (
          <Row k="Parent">
            <a href={href.thread(parent.id)} className="inline-flex items-center gap-1.5 hover:underline">
              <StatusDot status={parent.status} size={6} /> {parent.title}
            </a>
          </Row>
        )}
        {init?.mcp && init.mcp.length > 0 && (
          <Row k="MCP">
            <McpList servers={init.mcp} />
          </Row>
        )}
        <Row k="Created">{fullDate(thread.created_at)}</Row>
        <Row k="Updated">{fullDate(thread.updated_at)}</Row>
        {lastResult?.duration_ms != null && (
          <Row k="Last run">
            {duration(lastResult.duration_ms)}
            {lastResult.turns ? <span className="text-fg-3"> · {plural(lastResult.turns, 'turn')}</span> : null}
            {lastResult.model ? <span className="text-fg-3"> · {lastResult.model}</span> : null}
            {lastResult.input_tokens != null ? (
              <span className="text-fg-3">
                {' '}
                · {lastResult.input_tokens} in / {lastResult.output_tokens ?? 0} out
              </span>
            ) : null}
          </Row>
        )}
      </dl>

      {children.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center px-2">
            <span className="caption">Delegated threads</span>
            <span className="ml-auto font-num text-[11px] text-fg-3">{children.length}</span>
          </div>
          <div className="rounded-[20px] bg-bg p-1">
            {children.map((c) => (
              <a key={c.id} href={href.thread(c.id)} className="hov flex h-9 min-w-0 items-center gap-2.5 rounded-full px-3 text-[12.5px] [--hov:var(--surface)]">
                <StatusDot status={c.status} size={7} />
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                {c.task_id && <span className="shrink-0 font-mono text-[11px] text-fg-4">{c.task_id}</span>}
                <span className="shrink-0 text-[11px] text-fg-3">#{c.channel_id}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {remote ? (
        <div className="mt-4 rounded-[20px] bg-bg p-3.5">
          <div className="caption mb-2">Remote session</div>
          <p className="text-[12.5px] leading-relaxed text-fg-2">
            This thread runs on the Hermes server. Another message here resumes <span className="font-mono">{thread.session_id}</span>.
          </p>
        </div>
      ) : (
        <div className="mt-4 rounded-[20px] bg-bg p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="caption">Resume in terminal</span>
            <CopyButton text={resume} />
          </div>
          <code className="block rounded-xl bg-surface px-3 py-2.5 font-mono text-[11.5px] break-all text-fg-2">{resume}</code>
        </div>
      )}
    </div>
  );
}
