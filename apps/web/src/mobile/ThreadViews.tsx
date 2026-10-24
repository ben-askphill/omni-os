// The screens pushed from a thread: its steps, changes and PR, the channel browser, the shell, details and a file.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { turnCount } from '@omni/shared/history.ts';
import { api, artifactUrl, errorText, useApi, type HarnessWithRunning, type PRDetail } from '../api.ts';
import { HarnessMark, harnessLabel } from '../components/brand.tsx';
import { ArtifactBody } from '../components/ArtifactViewer.tsx';
import { AnnotateLayer, canAnnotate, useAfterAdd } from '../components/BrowserAnnotate.tsx';
import { BrowserWatch, displayUrl, useChannelBrowser } from '../components/LiveBrowser.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { modelOf } from '../components/ModelPicker.tsx';
import { ChangesTab } from '../components/thread/panel/ChangesTab.tsx';
import { usePRWatch, watchCopy } from '../components/thread/PRWatch.tsx';
import { OPEN_PR_PROMPT, useThreadPR } from '../components/thread/ThreadPR.tsx';
import { TerminalView } from '../components/TerminalView.tsx';
import { ThreadIdCtx, ToolOutput } from '../components/thread/ToolOutput.tsx';
import { Button, Chip, copyText, ErrorNote, Icon, SlideToConfirm, StatusDot } from '../components/ui.tsx';
import { cloudAgentUrl } from '../cloud-agent.ts';
import { carriedText } from '@omni/shared/continue.ts';
import { linkName } from '../components/ContinueLinks.tsx';
import { fullDate, plural } from '../format.ts';
import { checkTone } from '../pages/PRs.tsx';
import type { Route } from '../router.ts';
import { useApp } from '../store.tsx';
import { toolLabel, toolSummary, type Item, type ToolCall } from '../transcript/fold.ts';
import { MoDiff, MoEmpty, MoGroup, MoHeader, MoListRow, MoRound, MoSection } from './parts.tsx';
import { useShell, useThread } from './shell.tsx';
import { threadView } from './thread-view.ts';
import { holds } from '../thread-history.ts';
import { hasLiveOutput, outputTarget } from '../tool-output.ts';

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

const OUTPUT_BOX = 'rounded-[10px] bg-surface-2 px-[9px] py-1.5 font-mono text-[12px] leading-[1.45] break-words whitespace-pre-wrap';

/** `tails`: the turn's harness reports a call's output while it runs, so a running step has one to follow. */
function Step({ c, depth, running, cwd, tails }: { c: ToolCall; depth: number; running: boolean; cwd: string; tails: boolean }) {
  const [open, setOpen] = useState(false);
  const out = outputOf(c);
  const state = !c.result ? (running ? 'running' : 'stopped') : c.result.is_error ? 'failed' : 'done';
  const target = outputTarget(c, running);
  // A step Ben opened stays openable when its call settles, so the card does not fold away under his thumb.
  const tappable = open || target?.kind === 'saved' || (target?.kind === 'live' && tails);
  const head = (
    <>
      <span className="flex items-center gap-2.5">
        <StatusDot status={state} size={8} />
        <span className="shrink-0 text-[13px] font-medium">{toolLabel(c.name)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] leading-[1.3] text-fg-2">{toolSummary(c, cwd)}</span>
        {tappable && <Icon name="chevronRight" size={14} className={`shrink-0 text-fg-4 transition-transform duration-300 [transition-timing-function:var(--ease-settle)] ${open ? 'rotate-90' : ''}`} />}
      </span>
      {out && !open && <span className={`ml-[18px] block ${OUTPUT_BOX} ${state === 'failed' ? 'text-fg' : 'text-fg-3'}`}>{out}</span>}
    </>
  );
  return (
    <>
      <div className="flex flex-col rounded-2xl bg-surface" style={{ marginLeft: depth * 14 }}>
        {tappable ? (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-11 w-full flex-col justify-center gap-1.5 rounded-2xl px-3.5 py-[11px] text-left">
            {head}
          </button>
        ) : (
          <div className="flex flex-col gap-1.5 px-3.5 py-[11px]">{head}</div>
        )}
        {open && (
          <div className="flex flex-col gap-2 px-3.5 pb-[11px]">
            <ToolOutput call={c} running={running} touch box={(text) => <div className={`mo-scroll max-h-[60vh] overflow-auto ${OUTPUT_BOX} ${state === 'failed' ? 'text-fg' : 'text-fg-3'}`}>{text || '(no output)'}</div>} />
          </div>
        )}
      </div>
      {c.children.map((k) => (
        <Step key={k.id} c={k} depth={depth + 1} running={running} cwd={cwd} tails={tails} />
      ))}
    </>
  );
}

function StepItem({ it, running, cwd, tails }: { it: Item; running: boolean; cwd: string; tails: boolean }) {
  if (it.type === 'tools') return it.calls.map((c) => <Step key={c.id} c={c} depth={0} running={running} cwd={cwd} tails={tails} />);
  if (it.type === 'text') return <Markdown text={it.p.text} className="px-1 py-1 text-[14px] leading-[1.55] text-fg-2" />;
  if (it.type === 'error') return <ErrorNote>{it.p.text}</ErrorNote>;
  return null;
}

/** Every call a turn made, in order, with what the agent said between them. */
export function StepsScreen({ turn }: { turn?: number }) {
  const shell = useShell();
  const { thread, events, history, files, children, ready } = useThread();
  const spans = history.history.spans;
  const view = useMemo(() => (thread ? threadView({ events, spans, thread, artifacts: files, children }) : null), [events, spans, thread, files, children]);
  // A link to an older turn than the thread holds loads the page with it.
  const held = !turn || holds(history.history, turn);
  const { reveal } = history;
  useEffect(() => {
    if (ready && turn && !held) void reveal(turn);
  }, [ready, turn, held, reveal]);
  const t = view?.turns.find((x) => x.key === turn) ?? (held ? view?.turns[view.turns.length - 1] : undefined);
  const running = !!t && t.status === 'running';
  const tails = !!t && hasLiveOutput(t.harness);
  return (
    <>
      <MoHeader onBack={shell.back} title="Steps" sub={thread?.title} />
      <ThreadIdCtx.Provider value={thread?.id ?? ''}>
        <Body className="gap-2">
          {t ? t.items.map((it) => <StepItem key={it.key} it={it} running={running} cwd={thread?.cwd ?? ''} tails={tails} />) : <MoEmpty>{held ? 'No steps yet.' : 'Loading'}</MoEmpty>}
          {t && !t.steps && <MoEmpty>This turn answered without calling a tool.</MoEmpty>}
        </Body>
      </ThreadIdCtx.Provider>
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
  const watch = usePRWatch(thread?.id, mark);
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
  const canWatch = open || watch.watching;
  const { action, line } = watchCopy(watch.watch);
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
        {(canWatch || watch.watch) && (
          <div className="flex flex-col gap-2">
            <MoGroup>
              <MoListRow
                icon={<Icon name="bell" size={18} className={watch.watching ? 'text-live-text' : ''} />}
                label={canWatch ? action : line}
                sub={canWatch ? line : undefined}
                onClick={canWatch ? () => void (watch.watching ? watch.stop() : watch.start()) : undefined}
                chevron={false}
                disabled={watch.busy}
                last
              />
            </MoGroup>
            {watch.error && <ErrorNote>{watch.error}</ErrorNote>}
          </div>
        )}
        {p.checkRuns.length > 0 && (
          <MoSection title="Checks" count={p.checkRuns.length} pad={false}>
            <MoGroup>
              {p.checkRuns.map((c, i) => (
                <MoListRow key={`${c.name}:${i}`} icon={<StatusDot status={checkTone(c.state)} size={9} />} label={c.name} right={c.state.toLowerCase().replace(/_/g, ' ')} chevron={false} last={i === p.checkRuns.length - 1} />
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
  return thread ? <BrowserBody channelId={thread.channel_id} threadId={thread.id} onBack={shell.back} /> : <MoHeader onBack={shell.back} title="Browser" />;
}

function BrowserBody({ channelId, threadId, onBack }: { channelId: string; threadId: string; onBack: () => void }) {
  const b = useChannelBrowser(channelId);
  const url = b.state?.url ? displayUrl(b.state.url) : null;
  const [annotating, setAnnotating] = useState(false);
  const close = useCallback(() => setAnnotating(false), []);
  const added = useAfterAdd(close);
  return (
    <>
      <MoHeader onBack={onBack} title="Browser" sub={[url, 'watch only'].filter(Boolean).join(' · ')} right={<MoRound icon="annotate" label="Annotate this page" disabled={!canAnnotate(b.state)} onClick={() => setAnnotating(true)} />} />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-3 pt-1" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] bg-surface">
          <BrowserWatch b={b} />
          {annotating && <AnnotateLayer channelId={channelId} threadId={threadId} onClose={close} onAdded={added} />}
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
      <MoHeader onBack={shell.back} title="Terminal" sub="Read only · tap lines to add them to a message" />
      <div className="flex min-h-0 flex-1 flex-col px-3 pt-1" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
        {thread ? <TerminalView threadId={thread.id} cwd={thread.cwd} readOnly /> : <MoEmpty>Loading</MoEmpty>}
      </div>
    </>
  );
}

// ---------- Details ----------

export function DetailsScreen() {
  const shell = useShell();
  const { thread, init, lastResult, links, history } = useThread();
  const { channel } = useApp();
  const { data: harnesses } = useApi<HarnessWithRunning[]>('/harnesses');
  if (!thread) return <MoHeader onBack={shell.back} title="Details" />;
  const turns = turnCount(history.history);
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
  if (links.from)
    rows.push([
      'Continued from',
      <span className="flex flex-col py-2">
        <span className="truncate">{linkName(links.from)}</span>
        {links.from.carried && <span className="text-[12.5px] leading-[1.35] whitespace-normal text-fg-3">{carriedText(links.from.carried)}</span>}
      </span>,
    ]);
  if (links.into.length)
    rows.push([
      'Continued in',
      <span className="flex flex-col py-2">
        {links.into.map((l) => (
          <span key={l.id} className="truncate">
            {linkName(l)}
          </span>
        ))}
      </span>,
    ]);
  const agentUrl = thread.harness === 'cursor-cloud' ? cloudAgentUrl(thread.session_id) : null;
  if (agentUrl)
    rows.push([
      'Agent',
      <a href={agentUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-fg">
        Open in Cursor
      </a>,
    ]);
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
        <p className="m-0 px-1 text-[13px] leading-[1.5] text-fg-3">
          {thread.harness === 'cursor-cloud'
            ? "This thread runs as a Cursor cloud agent on Cursor's Linux cloud, on its own clone of the channel repo. Another message goes to it as a follow-up."
            : 'The session id, working directory and resume command are on the Mac, under Details in the thread panel.'}
        </p>
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
