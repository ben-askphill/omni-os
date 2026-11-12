import { useState, type ReactNode } from 'react';
import { type ThreadLinks } from '@omni/shared/continue-flow.ts';
import { useApi, type BackgroundTask, type Channel, type HarnessWithRunning, type Thread } from '../../../api.ts';
import { threadRunLabels } from '@omni/shared/thread-run.ts';
import { HarnessMark } from '../../brand.tsx';
import { Chip, CopyButton, Icon, StatusDot } from '../../ui.tsx';
import { duration, fullDate, plural } from '../../../format.ts';
import { href } from '../../../router.ts';
import { cloudAgentUrl } from '@omni/shared/cloud-agent.ts';
import type { PanelTab } from '../../../pages/useThreadSession.ts';
import type { PRNext, PRStep } from '@omni/shared/thread-glance.ts';
import { AgentsSection } from './AgentsSection.tsx';
import { CrewGlance, GlanceCard, type BranchChanges } from './GlanceCard.tsx';
import type { ThreadPRs } from './PRsTab.tsx';

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

/** One line: how many servers connected and how many did not. The names show only when asked for, failed ones first. */
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
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="group flex max-w-full items-center gap-1 text-left text-fg-2 hover:text-fg">
        <span className="truncate">
          {good.length} connected
          {bad.length > 0 && <span className="text-fg-3"> · {bad.length} not connected</span>}
        </span>
        <Icon name="chevronDown" size={12} className={`shrink-0 text-fg-3 transition-transform group-hover:text-fg-3 ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {bad.map((p) => (
            <Chip key={p.key} tone="outline" title={`${p.name} (${p.status})`}>
              {p.label}
            </Chip>
          ))}
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
      <dd className="min-w-0 text-fg [overflow-wrap:anywhere]">{children}</dd>
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
  links,
  agents,
  onJump,
  prs,
  changes,
  next,
  step = null,
  onAsk = () => {},
  onMerged = () => {},
  onTab = () => {},
}: {
  thread: Thread;
  channel: Channel | undefined;
  parent: Thread | null;
  children: Thread[];
  init: InitP | null;
  lastResult: ResultP | null;
  warm: boolean | undefined;
  links: ThreadLinks;
  /** Its running sub-agents (subagents.ts), listed with its other agents near the top. */
  agents: BackgroundTask[];
  onJump: (eventId: number) => void;
  /** The branch card on top: its PRs, changes, the step its PR calls for, and how to take it. */
  prs?: ThreadPRs;
  changes?: BranchChanges;
  next?: PRNext;
  /** The step the agent is working on, so its button shows it. */
  step?: PRStep | null;
  onAsk?: (prompt: string) => void;
  /** After a Merge button merged a PR, to read the PRs again. */
  onMerged?: () => void;
  onTab?: (tab: PanelTab) => void;
}) {
  const { data: harnesses } = useApi<HarnessWithRunning[]>('/harnesses');
  const cwd = init?.cwd || thread.cwd;
  const cloud = thread.harness === 'cursor-cloud';
  const remote = thread.harness === 'hermes' || cloud;
  const agentUrl = cloud ? cloudAgentUrl(thread.session_id) : null;
  const resumeCmd: Record<string, string> = {
    'claude-code': `claude --resume ${thread.session_id}`,
    codex: `codex resume ${thread.session_id}`,
    cursor: `cursor-agent --resume ${thread.session_id}`,
  };
  // The composer's model pill reads these too, so Details names the model and effort the same way.
  const run = threadRunLabels(thread, harnesses);
  const slug = thread.model || init?.model;
  const resume = remote ? '' : `cd ${shellQuote(cwd)} && ${resumeCmd[thread.harness] ?? resumeCmd['claude-code']}`;
  return (
    <div className="scroll-thin flex h-full flex-col gap-3 overflow-y-auto px-2.5 pb-3 [&>*]:shrink-0">
      <GlanceCard thread={thread} prs={prs} changes={changes ?? null} next={next ?? null} step={step} onAsk={onAsk} onMerged={onMerged} onTab={onTab} />
      {prs && <CrewGlance crew={prs.crew} onMerged={onMerged} onTab={onTab} />}
      <AgentsSection parent={parent} links={links} children={children} agents={agents} onJump={onJump} />
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
          {run.model}
          {slug && slug !== run.model && <span className="ml-1.5 font-mono text-[11.5px] text-fg-3">{slug}</span>}
          {thread.model && init?.model && init.model !== thread.model && <span className="ml-1.5 font-mono text-[11.5px] text-fg-3">({init.model})</span>}
        </Row>
        <Row k="Effort">{run.effort}</Row>
        {thread.auto_reason && <Row k="Auto">{thread.auto_reason}</Row>}
        <Row k="Source">
          {thread.source}
          {thread.automation && <span className="text-fg-3"> · {thread.automation}</span>}
        </Row>
        <Row k="Working dir">
          {remote ? (
            <span className="text-fg-3">{cloud ? 'Cursor cloud agent, not an Omni worktree' : 'Hermes server, not an Omni worktree'}</span>
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

      {remote ? (
        <div className="rounded-[20px] bg-bg p-3.5">
          <div className="caption mb-2">{cloud ? 'Cursor cloud agent' : 'Remote session'}</div>
          {cloud ? (
            <p className="text-[12.5px] leading-relaxed text-fg-2">
              This thread runs on Cursor's Linux cloud, on its own clone of the channel repo. It pushes a branch and Cursor opens the PR. Another message here
              goes to the agent as a follow-up.{' '}
              {agentUrl ? (
                <a href={agentUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-fg underline-offset-2 hover:underline">
                  Open it in Cursor
                </a>
              ) : (
                'It has not started yet.'
              )}
            </p>
          ) : (
            <p className="text-[12.5px] leading-relaxed text-fg-2">
              This thread runs on the Hermes server. Another message here resumes <span className="font-mono">{thread.session_id}</span>.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-[20px] bg-bg p-3.5">
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
