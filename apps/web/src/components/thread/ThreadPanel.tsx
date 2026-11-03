import { lazy, Suspense, useState, type ComponentProps } from 'react';
import type { Artifact, Thread } from '../../api.ts';
import type { PanelTab } from '../../pages/useThreadSession.ts';
import { plural } from '../../format.ts';
import { crewLine, prLine } from '@omni/shared/thread-glance.ts';
import { desktop } from '../../desktop.ts';
import { IconButton, Loading, Segmented, StatusDot } from '../ui.tsx';
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
 * The thread's inspector: a tab strip over Details, PRs, Artifacts, Changes, Browser, Terminal and Actions. Details
 * leads with the branch card and PRs follows, the two Ben reaches for most.
 */
export function ThreadPanel({
  thread,
  files,
  shots,
  selectedArtifact,
  onSelect,
  tab,
  onTab,
  onClose,
  details,
  prs,
}: {
  thread: Thread;
  files: Artifact[];
  shots: ComponentProps<typeof BrowserTab>['shots'];
  selectedArtifact: ComponentProps<typeof ArtifactsTab>['selected'];
  onSelect: ComponentProps<typeof ArtifactsTab>['onSelect'];
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
  details: Omit<Details, 'thread'>;
  prs: Omit<PRs, 'thread'>;
}) {
  const { agents } = details;
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
            label="Thread inspector"
            size="sm"
            value={tab}
            onChange={onTab}
            options={[
              {
                id: 'details',
                icon: 'info',
                title: 'Details',
                badge: agents.length ? (
                  <span className="font-num text-[10.5px] text-fg-4" title={`${plural(agents.length, 'subagent')} running`}>
                    {agents.length}
                  </span>
                ) : undefined,
              },
              {
                id: 'prs',
                icon: 'pr',
                title: prTab?.title ?? 'PRs',
                badge: prTab ? <StatusDot status={PR_DOT[prTab.tone]} size={6} /> : undefined,
              },
              { id: 'artifacts', icon: 'layers', title: 'Artifacts', badge: files.length ? <span className="font-num text-[10.5px] text-fg-4">{files.length}</span> : undefined },
              { id: 'changes', icon: 'diff', title: 'Changes' },
              { id: 'browser', icon: 'browser', title: 'Browser', badge: shots.length ? <span className="font-num text-[10.5px] text-fg-4">{shots.length}</span> : undefined },
              ...(desktop ? [{ id: 'web' as const, icon: 'globe' as const, title: 'Web' }] : []),
              { id: 'terminal', icon: 'terminal', title: 'Terminal' },
              { id: 'actions', icon: 'play', title: 'Actions' },
            ]}
          />
        </div>
        <IconButton icon="x" label="Close panel" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'details' && <DetailsTab thread={thread} {...details} />}
        {tab === 'prs' && <PRsTab thread={thread} {...prs} />}
        {tab === 'artifacts' && <ArtifactsTab artifacts={files} selected={selectedArtifact} onSelect={onSelect} />}
        {tab === 'changes' && <ChangesTab thread={thread} />}
        {tab === 'browser' && <BrowserTab channelId={thread.channel_id} threadId={thread.id} shots={shots} />}
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
