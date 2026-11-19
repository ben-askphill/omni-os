import { lazy, Suspense, useId, useState, type ComponentProps } from 'react';
import type { Artifact, ArtifactWithThread, Thread } from '../../api.ts';
import type { PanelTab } from '../../pages/useThreadSession.ts';
import { plural } from '../../format.ts';
import { crewLine, prLine } from '@omni/shared/thread-glance.ts';
import { desktop } from '../../desktop.ts';
import { IconButton, Loading, Segmented, StatusDot, tabPanelProps, type IconName } from '../ui.tsx';
import { ActionsTab } from './panel/ActionsTab.tsx';
import { ArtifactsTab } from './panel/ArtifactsTab.tsx';
import { BrowserTab } from './panel/BrowserTab.tsx';
import { ChangesTab } from './panel/ChangesTab.tsx';
import { DetailsTab } from './panel/DetailsTab.tsx';
import { PRsTab } from './panel/PRsTab.tsx';

// xterm.js is large; load it the first time the tab opens.
const TerminalView = lazy(() => import('../TerminalView.tsx').then((m) => ({ default: m.TerminalView })));
// The desktop app's Web tab, which a browser or a phone never loads.
const NativeBrowser = lazy(() => import('../NativeBrowser.tsx').then((m) => ({ default: m.NativeBrowser })));

type Details = ComponentProps<typeof DetailsTab>;
type PRs = ComponentProps<typeof PRsTab>;

const PR_DOT = { live: 'running', done: 'done', needs: 'needs', outline: 'idle' } as const;

/**
 * The tabs, in order. The open one shows its name beside the icon. Browser is the agent's browser; Web is Ben's own, a
 * desktop-app page the agent cannot see, and each title says whose it is.
 */
const TABS: { id: PanelTab; icon: IconName; name: string; title: string }[] = [
  { id: 'details', icon: 'info', name: 'Details', title: 'Details' },
  { id: 'prs', icon: 'pr', name: 'PRs', title: 'PRs' },
  { id: 'artifacts', icon: 'layers', name: 'Artifacts', title: 'Artifacts' },
  { id: 'changes', icon: 'diff', name: 'Changes', title: 'Changes' },
  { id: 'browser', icon: 'browser', name: 'Browser', title: "Browser: the agent's browser and what it saw" },
  { id: 'web', icon: 'globe', name: 'Web', title: 'Web: your own browser on this Mac. The agent cannot see it' },
  { id: 'terminal', icon: 'terminal', name: 'Terminal', title: 'Terminal' },
  { id: 'actions', icon: 'play', name: 'Actions', title: 'Actions' },
];

/** The tabs a thread outside a code project leaves out while Show technical details is off. */
const CODE_TABS: ReadonlySet<PanelTab> = new Set<PanelTab>(['prs', 'changes', 'terminal', 'actions']);

/**
 * The thread's inspector: a tab strip over Details, PRs, Artifacts, Changes, Browser, Terminal and Actions. Details
 * leads with the branch card and PRs follows, the two Ben reaches for most.
 */
export function ThreadPanel({
  thread,
  files,
  shots,
  crewArtifacts,
  selectedArtifact,
  onSelect,
  tab: picked,
  onTab,
  onClose,
  details,
  prs,
  code = true,
}: {
  thread: Thread;
  /** Show technical details is on, or the channel has a repo: the PRs, Changes and Terminal tabs show. */
  code?: boolean;
  files: Artifact[];
  shots: ComponentProps<typeof BrowserTab>['shots'];
  /** The files and screenshots of the threads it delegated to, listed under its own. */
  crewArtifacts: { files: ArtifactWithThread[]; shots: ArtifactWithThread[] };
  selectedArtifact: ComponentProps<typeof ArtifactsTab>['selected'];
  onSelect: ComponentProps<typeof ArtifactsTab>['onSelect'];
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
  details: Omit<Details, 'thread'>;
  prs: Omit<PRs, 'thread'>;
}) {
  const { agents } = details;
  const panel = useId();
  const fileCount = files.length + crewArtifacts.files.length;
  const shotCount = shots.length + crewArtifacts.shots.length;
  // Outside a code project with the switch off, a tab shows only with something in it: no code tabs, and Artifacts and
  // Browser once there is a file or a screenshot. Web is the user's own browser, so it stays.
  const shows = (t: PanelTab) =>
    (desktop || t !== 'web') && (code || (!CODE_TABS.has(t) && (t !== 'artifacts' || fileCount > 0) && (t !== 'browser' || shotCount > 0)));
  // A tab this thread does not show (a remembered PRs tab in a channel without a repo) opens Details.
  const tab = shows(picked) ? picked : 'details';
  // The channel whose Web tab was opened. It stays mounted while another tab shows: the page, a form half filled in
  // and a sign-in midway live only in it.
  const [webFor, setWebFor] = useState<string | null>(null);
  if (tab === 'web' && webFor !== thread.channel_id) setWebFor(thread.channel_id);
  const pr = prs.data?.pr;
  const line = pr ? prLine(pr) : null;
  const crew = prs.data?.crew ?? [];
  // The thread's own PR leads. A thread without one shows what its delegated threads opened.
  const crewSum = crew.length ? crewLine(crew) : null;
  const prTab = pr && line ? { title: `PRs: #${pr.number}, ${line.text}`, tone: line.tone } : crewSum ? { title: `PRs: ${plural(crew.length, 'PR')} from delegated threads, ${crewSum.text}`, tone: crewSum.tone } : null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-2.5 py-2.5">
        <div className="scroll-thin min-w-0 flex-1 overflow-x-auto">
          <Segmented
            kind="tabs"
            panel={panel}
            // Terminal and Web start a process or a page, and Terminal takes the focus: arrowing past them must not.
            manual
            label="Thread inspector"
            className="inspector-tabs"
            value={tab}
            onChange={onTab}
            options={TABS.filter((t) => shows(t.id)).map((t) => ({
              ...t,
              label: t.id === tab ? t.name : undefined,
              title: t.id === 'prs' && prTab ? prTab.title : t.title,
              badge:
                t.id === 'details' && agents.length ? (
                  <span className="font-num text-[10.5px] text-fg-3" title={`${plural(agents.length, 'subagent')} running`}>
                    {agents.length}
                  </span>
                ) : t.id === 'prs' && prTab ? (
                  <StatusDot status={PR_DOT[prTab.tone]} phase={prTab.tone === 'live' ? 'checking' : null} size={6} />
                ) : t.id === 'artifacts' && fileCount ? (
                  <span className="font-num text-[10.5px] text-fg-3">{fileCount}</span>
                ) : t.id === 'browser' && shotCount ? (
                  <span className="font-num text-[10.5px] text-fg-3">{shotCount}</span>
                ) : undefined,
            }))}
          />
        </div>
        <IconButton icon="x" label="Close panel" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1" {...tabPanelProps(panel, tab)}>
        {tab === 'details' && <DetailsTab thread={thread} {...details} />}
        {tab === 'prs' && <PRsTab thread={thread} {...prs} />}
        {tab === 'artifacts' && <ArtifactsTab artifacts={files} crew={crewArtifacts.files} selected={selectedArtifact} onSelect={onSelect} />}
        {tab === 'changes' && <ChangesTab thread={thread} />}
        {tab === 'browser' && <BrowserTab channelId={thread.channel_id} threadId={thread.id} shots={shots} crew={crewArtifacts.shots} />}
        {desktop && webFor === thread.channel_id && (
          <div className={tab === 'web' ? 'h-full' : 'hidden'}>
            <Suspense fallback={<Loading />}>
              <NativeBrowser channelId={thread.channel_id} threadId={thread.id} />
            </Suspense>
          </div>
        )}
        {tab === 'terminal' && (
          <Suspense fallback={<Loading />}>
            <TerminalView threadId={thread.id} cwd={thread.cwd} />
          </Suspense>
        )}
        {tab === 'actions' && <ActionsTab thread={thread} />}
      </div>
    </div>
  );
}
