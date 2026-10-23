// The screens pushed from a thread: its steps, changes and PR, the channel browser, the shell, details and a file.
import { useMemo, useState, type ReactNode } from 'react';
import { api, artifactUrl, errorText, useApi, type HarnessWithRunning, type PRDetail } from '../api.ts';
import { HarnessMark, harnessLabel } from '../components/brand.tsx';
import { ArtifactBody } from '../components/ArtifactViewer.tsx';
import { BrowserWatch, displayUrl, useChannelBrowser } from '../components/LiveBrowser.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { modelOf } from '../components/ModelPicker.tsx';
import { ChangesTab } from '../components/thread/panel/ChangesTab.tsx';
import { OPEN_PR_PROMPT, useThreadPR } from '../components/thread/ThreadPR.tsx';
import { TerminalView } from '../components/TerminalView.tsx';
import { Button, Chip, copyText, ErrorNote, SlideToConfirm, StatusDot } from '../components/ui.tsx';
import { fullDate, plural } from '../format.ts';
import { checkTone } from '../pages/PRs.tsx';
import type { Route } from '../router.ts';
import { useApp } from '../store.tsx';
import { toolLabel, toolSummary, type Item, type ToolCall } from '../transcript/fold.ts';
import { MoDiff, MoEmpty, MoGroup, MoHeader, MoListRow, MoRound, MoSection } from './parts.tsx';
import { useShell, useThread } from './shell.tsx';
import { threadView } from './thread-view.ts';

const SOURCE: Record<string, string> = { manual: 'You', conductor: 'The Conductor', team: 'Its team lead', automation: 'Automation', import: 'Imported', capture: 'Captured' };

function Body({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mo-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 ${className}`} style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
      {children}
    </div>
  );
}

// ---------- Steps ----------

/** The output worth a line under a step: a failure's message, and what a command printed. */
const outputOf = (c: ToolCall) => (c.result && (c.result.is_error || c.name === 'Bash') ? c.result.text.trim().split('\n').slice(0, 3).join('\n').slice(0, 240) : '');

function Step({ c, depth, running, cwd }: { c: ToolCall; depth: number; running: boolean; cwd: string }) {
  const out = outputOf(c);
  const state = !c.result ? (running ? 'running' : 'stopped') : c.result.is_error ? 'failed' : 'done';
  return (
    <>
      <div className="flex flex-col gap-1.5 rounded-2xl bg-surface px-3.5 py-[11px]" style={{ marginLeft: depth * 14 }}>
        <div className="flex items-center gap-2.5">
          <StatusDot status={state} size={8} />
          <span className="shrink-0 text-[13px] font-medium">{toolLabel(c.name)}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] leading-[1.3] text-fg-2">{toolSummary(c, cwd)}</span>
        </div>
        {out && <div className={`ml-[18px] rounded-[10px] bg-surface-2 px-[9px] py-1.5 font-mono text-[12px] leading-[1.45] break-words whitespace-pre-wrap ${state === 'failed' ? 'text-fg' : 'text-fg-3'}`}>{out}</div>}
      </div>
      {c.children.map((k) => (
        <Step key={k.id} c={k} depth={depth + 1} running={running} cwd={cwd} />
      ))}
    </>
  );
}

function StepItem({ it, running, cwd }: { it: Item; running: boolean; cwd: string }) {
  if (it.type === 'tools') return it.calls.map((c) => <Step key={c.id} c={c} depth={0} running={running} cwd={cwd} />);
  if (it.type === 'text') return <Markdown text={it.p.text} className="px-1 py-1 text-[14px] leading-[1.55] text-fg-2" />;
  if (it.type === 'error') return <ErrorNote>{it.p.text}</ErrorNote>;
  return null;
}

/** Every call a turn made, in order, with what the agent said between them. */
export function StepsScreen({ turn }: { turn?: number }) {
  const shell = useShell();
  const { thread, events, files, children } = useThread();
  const view = useMemo(() => (thread ? threadView({ events, thread, artifacts: files, children }) : null), [events, thread, files, children]);
  const t = view?.turns.find((x) => x.key === turn) ?? view?.turns[view.turns.length - 1];
  const running = !!t && t.status === 'running';
  return (
    <>
      <MoHeader onBack={shell.back} title="Steps" sub={thread?.title} />
      <Body className="gap-2">
        {t ? t.items.map((it) => <StepItem key={it.key} it={it} running={running} cwd={thread?.cwd ?? ''} />) : <MoEmpty>No steps yet.</MoEmpty>}
        {t && !t.steps && <MoEmpty>This turn answered without calling a tool.</MoEmpty>}
      </Body>
    </>
  );
}

// ---------- Changes and PR ----------

export function ChangesScreen() {
  const shell = useShell();
  const { thread } = useThread();
  return (
    <>
      <MoHeader onBack={shell.back} title="Changes" sub={thread?.branch ?? thread?.title} />
      <div className="min-h-0 flex-1 pt-1" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {thread ? <ChangesTab thread={thread} /> : <MoEmpty>Loading</MoEmpty>}
      </div>
    </>
  );
}

/** The thread branch's PR: what it changes, its checks, and a squash merge behind a slide. */
export function PRScreen() {
  const shell = useShell();
  const { thread, slotBusy, applyThread } = useThread();
  const { channel } = useApp();
  const mark = useThreadPR(thread, slotBusy, true);
  const ch = thread ? channel(thread.channel_id) : undefined;
  const n = mark?.pr?.number;
  const q = useApi<PRDetail>(n && ch?.github_repo ? `/channels/${encodeURIComponent(ch.id)}/prs/${n}` : null);
  const [error, setError] = useState<string | null>(null);
  const p = q.data;

  const merge = async () => {
    setError(null);
    try {
      await api.post(`/channels/${encodeURIComponent(ch!.id)}/prs/${n}/merge`, { method: 'squash', delete_branch: true, confirm: true });
      shell.toast(`Merged #${n}`);
      q.reload();
    } catch (e) {
      setError(errorText(e));
      throw e;
    }
  };
  const openPR = async () => {
    if (!thread) return;
    try {
      applyThread(await api.post(`/threads/${encodeURIComponent(thread.id)}/messages`, { prompt: OPEN_PR_PROMPT, mode: slotBusy ? 'queue' : undefined }), true);
      shell.toast('Asked for a PR');
      shell.back();
    } catch (e) {
      shell.toast(errorText(e));
    }
  };

  if (!thread || (thread.branch && !mark) || (n && ch?.github_repo && !p && !q.error)) {
    return (
      <>
        <MoHeader onBack={shell.back} title="Pull request" />
        <MoEmpty>Loading</MoEmpty>
      </>
    );
  }
  if (!n || !p) {
    return (
      <>
        <MoHeader onBack={shell.back} title="Pull request" sub={thread?.branch ?? undefined} />
        <Body className="gap-3">
          {q.error ? (
            <ErrorNote onRetry={q.reload}>{q.error}</ErrorNote>
          ) : (
            <MoEmpty>
              {n
                ? `PR #${n} is open. Set this channel's GitHub repo on the Mac to read it here.`
                : thread.branch
                  ? 'No pull request from this branch yet.'
                  : 'This thread works without a branch, so it has no pull request.'}
            </MoEmpty>
          )}
          {!n && thread.branch && (
            <div className="px-1">
              <Button size="lg" icon="pr" onClick={() => void openPR()}>
                Open PR
              </Button>
            </div>
          )}
        </Body>
      </>
    );
  }

  const open = !p.state || p.state === 'OPEN';
  const pending = p.checkRuns.filter((c) => checkTone(c.state) === 'running').length;
  const failing = p.checkRuns.filter((c) => checkTone(c.state) === 'needs').length;
  const note = [failing && `${plural(failing, 'check')} failing.`, pending && `${plural(pending, 'check')} still running. Merging now skips them.`, p.mergeable === 'CONFLICTING' && 'It conflicts with the base branch.']
    .filter(Boolean)
    .join(' ');
  return (
    <>
      <MoHeader
        onBack={shell.back}
        title={`#${p.number}`}
        sub={ch?.github_repo ?? undefined}
        right={<MoRound icon="external" label="Open on GitHub" onClick={() => window.open(p.url, '_blank', 'noopener')} />}
      />
      <Body className="gap-4">
        <div className="flex flex-col gap-2.5">
          <h2 className="m-0 font-head text-[22px] leading-[1.25] font-medium tracking-[-0.01em] text-pretty">{p.title}</h2>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-3">
            <Chip tone={open ? 'outline' : 'done'}>{open ? (p.isDraft ? 'Draft' : 'Open') : p.state === 'MERGED' ? 'Merged' : 'Closed'}</Chip>
            <MoDiff add={p.additions} del={p.deletions} /> · {plural(p.files.length, 'file')}
          </div>
          <span className="font-mono text-[12px] leading-[1.3] text-fg-3">
            {p.headRefName} → {p.baseRefName}
          </span>
        </div>
        {p.checkRuns.length > 0 && (
          <MoSection title="Checks" count={p.checkRuns.length} pad={false}>
            <MoGroup>
              {p.checkRuns.map((c, i) => (
                <MoListRow key={`${c.name}:${i}`} icon={<StatusDot status={checkTone(c.state)} size={9} />} label={c.name} right={c.state.toLowerCase()} chevron={false} last={i === p.checkRuns.length - 1} />
              ))}
            </MoGroup>
          </MoSection>
        )}
        <MoSection title="Files" count={p.files.length} pad={false}>
          <MoGroup>
            {p.files.map((f, i) => (
              <div key={f.path} className={`flex items-center gap-2.5 px-4 py-[13px] ${i ? 'border-t border-line' : ''}`}>
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] leading-[1.3]">{f.path}</span>
                <span className="text-[12.5px]">
                  <MoDiff add={f.additions} del={f.deletions} />
                </span>
              </div>
            ))}
          </MoGroup>
        </MoSection>
      </Body>
      {open && (
        <div className="flex shrink-0 flex-col gap-2 px-4 pt-2" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
          {note && <span className="text-center text-[12.5px] leading-[1.3] text-fg-3">{note}</span>}
          {error && <ErrorNote>{error}</ErrorNote>}
          <SlideToConfirm label="Slide to squash and merge" doneLabel={`Merged #${p.number}`} busyLabel="Merging" disabled={p.isDraft} onConfirm={merge} />
        </div>
      )}
    </>
  );
}

// ---------- Browser and terminal ----------

export function BrowserScreen() {
  const shell = useShell();
  const { thread } = useThread();
  return thread ? <BrowserBody channelId={thread.channel_id} onBack={shell.back} /> : <MoHeader onBack={shell.back} title="Browser" />;
}

function BrowserBody({ channelId, onBack }: { channelId: string; onBack: () => void }) {
  const b = useChannelBrowser(channelId);
  const url = b.state?.url ? displayUrl(b.state.url) : null;
  return (
    <>
      <MoHeader onBack={onBack} title="Browser" sub={[url, 'watch only'].filter(Boolean).join(' · ')} />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-3 pt-1" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] bg-surface">
          <BrowserWatch b={b} />
        </div>
        <p className="m-0 px-1 text-[13px] leading-[1.5] text-fg-3">The agent drives this browser. Logins and captchas are handled on the Mac.</p>
      </div>
    </>
  );
}

export function TerminalScreen() {
  const shell = useShell();
  const { thread } = useThread();
  return (
    <>
      <MoHeader onBack={shell.back} title="Terminal" sub="Read only · take over on the Mac" />
      <div className="flex min-h-0 flex-1 flex-col px-3 pt-1" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
        {thread ? <TerminalView threadId={thread.id} cwd={thread.cwd} readOnly /> : <MoEmpty>Loading</MoEmpty>}
      </div>
    </>
  );
}

// ---------- Details ----------

export function DetailsScreen() {
  const shell = useShell();
  const { thread, init, lastResult, events } = useThread();
  const { channel } = useApp();
  const { data: harnesses } = useApi<HarnessWithRunning[]>('/harnesses');
  if (!thread) return <MoHeader onBack={shell.back} title="Details" />;
  const turns = events.filter((e) => e.kind === 'result').length;
  const modelId = lastResult?.model || init?.model || thread.model || '';
  const { model } = harnesses ? modelOf(harnesses, { harness: thread.harness, model: modelId }) : { model: undefined };
  const rows: [string, ReactNode][] = [
    ['Channel', `#${channel(thread.channel_id)?.name ?? thread.channel_id}`],
    ['Crew role', thread.role || 'None'],
    [
      'Harness',
      <span className="inline-flex items-center gap-1.5">
        <HarnessMark harness={thread.harness} />
        {harnessLabel(thread.harness)}
      </span>,
    ],
    ['Model', model?.label ?? (modelId || 'Default')],
    ['Effort', thread.effort || (model?.defaultEffort ? `Default (${model.defaultEffort})` : 'Default')],
    ['Source', thread.automation ? `Automation ${thread.automation}` : (SOURCE[thread.source] ?? thread.source)],
    ['Started', fullDate(thread.created_at)],
    ['Turns', String(turns)],
  ];
  if (thread.task_id) rows.splice(2, 0, ['Task', <span className="font-mono text-[13px]">{thread.task_id}</span>]);
  if (thread.branch) rows.push(['Branch', <span className="font-mono text-[13px]">{thread.branch}</span>]);
  return (
    <>
      <MoHeader onBack={shell.back} title="Details" sub={thread.title} />
      <Body className="gap-4">
        <MoGroup>
          {rows.map(([k, v], i) => (
            <div key={k} className={`flex min-h-12 items-center px-4 text-[14.5px] ${i ? 'border-t border-line' : ''}`}>
              <span className="w-[104px] shrink-0 text-fg-3">{k}</span>
              <span className="min-w-0 flex-1 truncate">{v}</span>
            </div>
          ))}
        </MoGroup>
        <p className="m-0 px-1 text-[13px] leading-[1.5] text-fg-3">The session id, working directory and resume command are on the Mac, under Details in the thread panel.</p>
      </Body>
    </>
  );
}

// ---------- Viewer ----------

/** One file, full screen. Share hands over the published page, else the file itself. */
export function ViewerScreen({ route }: { route: Route }) {
  const shell = useShell();
  const { thread, files } = useThread();
  const { channel } = useApp();
  const id = route.name === 'thread' ? route.artifact : undefined;
  const a = files.find((f) => f.id === id);
  const share = async () => {
    if (!a) return;
    try {
      if (a.url) {
        if (navigator.share) await navigator.share({ title: a.name, url: a.url });
        else {
          await copyText(a.url);
          shell.toast('Link copied');
        }
        return;
      }
      const blob = await (await fetch(artifactUrl(a))).blob();
      const file = new File([blob], a.name, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: a.name });
      else {
        await copyText(new URL(artifactUrl(a), location.href).href);
        shell.toast('Link copied. It opens where Omni is paired.');
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') shell.toast(errorText(e));
    }
  };
  const sub = thread ? [`#${channel(thread.channel_id)?.name ?? thread.channel_id}`, thread.role].filter(Boolean).join(' · ') : undefined;
  return (
    <>
      <MoHeader
        left={<MoRound icon="x" label="Close" onClick={shell.back} />}
        title={<span className="font-mono text-[13.5px] font-normal">{a?.name ?? 'File'}</span>}
        sub={sub}
        right={a && <MoRound icon="share" label="Share" onClick={() => void share()} />}
      />
      <div className="mt-1 min-h-0 flex-1 overflow-hidden rounded-t-[22px] bg-elev shadow-[var(--shadow-card)]">
        {a ? <ArtifactBody a={a} /> : <MoEmpty>{thread ? 'This file is gone.' : 'Loading'}</MoEmpty>}
      </div>
    </>
  );
}
