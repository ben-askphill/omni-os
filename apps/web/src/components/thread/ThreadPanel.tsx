import { lazy, Suspense, type ComponentProps } from 'react';
import type { Artifact, Thread } from '../../api.ts';
import type { PanelTab } from '../../pages/useThreadSession.ts';
import { plural } from '../../format.ts';
import { IconButton, Loading, Segmented } from '../ui.tsx';
import { ActionsTab } from './panel/ActionsTab.tsx';
import { ArtifactsTab } from './panel/ArtifactsTab.tsx';
import { BrowserTab } from './panel/BrowserTab.tsx';
import { ChangesTab } from './panel/ChangesTab.tsx';
import { DetailsTab } from './panel/DetailsTab.tsx';

// xterm.js is large; load it the first time the tab opens.
const TerminalView = lazy(() => import('../TerminalView.tsx').then((m) => ({ default: m.TerminalView })));

type Details = ComponentProps<typeof DetailsTab>;

/** The thread's inspector: a tab strip over Artifacts, Changes, Browser, Terminal, Actions and Details. */
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
}) {
  const { agents } = details;
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
              { id: 'artifacts', icon: 'layers', title: 'Artifacts', badge: files.length ? <span className="font-num text-[10.5px] text-fg-4">{files.length}</span> : undefined },
              { id: 'changes', icon: 'diff', title: 'Changes' },
              { id: 'browser', icon: 'browser', title: 'Browser', badge: shots.length ? <span className="font-num text-[10.5px] text-fg-4">{shots.length}</span> : undefined },
              { id: 'terminal', icon: 'terminal', title: 'Terminal' },
              { id: 'actions', icon: 'play', title: 'Actions' },
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
            ]}
          />
        </div>
        <IconButton icon="x" label="Close panel" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'artifacts' && <ArtifactsTab artifacts={files} selected={selectedArtifact} onSelect={onSelect} />}
        {tab === 'changes' && <ChangesTab thread={thread} />}
        {tab === 'browser' && <BrowserTab channelId={thread.channel_id} threadId={thread.id} shots={shots} />}
        {tab === 'terminal' && (
          <Suspense fallback={<Loading />}>
            <TerminalView threadId={thread.id} cwd={thread.cwd} />
          </Suspense>
        )}
        {tab === 'actions' && <ActionsTab thread={thread} />}
        {tab === 'details' && <DetailsTab thread={thread} {...details} />}
      </div>
    </div>
  );
}
