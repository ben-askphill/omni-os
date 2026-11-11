import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ARTIFACT_FILTERS, matchesArtifactFilter, type ArtifactFilter } from '@omni/shared/artifacts.ts';
import { relTime, toDate } from '@omni/shared/format.ts';
import { useApi, type ArtifactWithThread } from '../api.ts';
import { ArtifactThumb } from '../components/ArtifactThumb.tsx';
import { artifactTitle, kindIcon } from '../components/ArtifactViewer.tsx';
import { ArtifactSourceSwitch, ClaudeArtifactsView, LayoutSwitch, useLayoutPref } from '../components/ClaudeArtifacts.tsx';
import { Chip, Empty, ErrorNote, Icon, Loading, PageHeader, Segmented } from '../components/ui.tsx';
import { pageColumn, PageToolbar, RefreshButton, SearchField } from '../components/ui/feedback.tsx';
import { href } from '../router.ts';
import { readPref, useApp, useFeed, writePref } from '../store.tsx';

/** Every artifact across channels, newest first, kept current from the feed. */
export function useArtifacts() {
  const res = useApi<ArtifactWithThread[]>('/artifacts');
  // Agents often rewrite a file several times in a row; one refetch per burst is enough.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { reload } = res;
  useFeed((e) => {
    const hit = e.type === 'reconnect' || (e.type === 'artifact' && e.artifact.kind !== 'screenshot');
    if (!hit || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      reload();
    }, 1500);
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  return res;
}

export function ArtifactsPage({ source }: { source?: 'claude' }) {
  if (source === 'claude') return <ClaudeArtifactsPage />;
  return <FilesPage />;
}

function ClaudeArtifactsPage() {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader width="page" title="Artifacts" subtitle="Your Artifacts on claude.ai, as Claude Code lists them. Each one opens on claude.ai." actions={<ArtifactSourceSwitch source="claude" />} />
      <div className={`${pageColumn('page')} pb-16`}>
        <ClaudeArtifactsView />
      </div>
    </div>
  );
}

const matchesSearch = (a: ArtifactWithThread, q: string) => {
  const t = q.trim().toLowerCase();
  return !t || a.name.toLowerCase().includes(t) || a.thread_title.toLowerCase().includes(t) || artifactTitle(a.name).toLowerCase().includes(t);
};

function FilesPage() {
  const { channel } = useApp();
  const res = useArtifacts();
  const [filter, setFilter] = useState<ArtifactFilter>('all');
  const [q, setQ] = useState('');
  const [layout, setLayout] = useLayoutPref('artifacts.layout', 'grid');

  const found = useMemo(() => (res.data ?? []).filter((a) => matchesSearch(a, q)), [res.data, q]);
  const list = useMemo(() => found.filter((a) => matchesArtifactFilter(filter, a.kind)), [found, filter]);
  const counts = useMemo(() => Object.fromEntries(ARTIFACT_FILTERS.map((f) => [f.id, found.filter((a) => matchesArtifactFilter(f.id, a.kind)).length])) as Record<ArtifactFilter, number>, [found]);

  // "New" means changed since the previous visit to this page. The first visit marks nothing.
  const [seenAt] = useState(() => readPref<number | null>('artifacts.seen', null));
  useEffect(() => writePref('artifacts.seen', Date.now()), []);
  const isNew = (a: ArtifactWithThread) => seenAt != null && toDate(a.updated_at).getTime() > seenAt;
  const channelName = (a: ArtifactWithThread) => channel(a.channel_id)?.name ?? a.channel_id;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader width="page" title="Artifacts" subtitle="Pages, reports and files your threads made, newest first." actions={<ArtifactSourceSwitch source="files" />} />
      <div className={`${pageColumn('page')} pb-16`}>
        <PageToolbar
          className="mb-5"
          right={
            <>
              <LayoutSwitch value={layout} onChange={setLayout} />
              <RefreshButton onClick={res.reload} busy={res.loading && !!res.data} label="Refresh artifacts" />
            </>
          }
        >
          <SearchField value={q} onChange={setQ} placeholder="Search files" label="Search files" />
          <div className="scroll-thin max-w-full overflow-x-auto">
            <Segmented
              label="Filter artifacts"
              value={filter}
              onChange={setFilter}
              size="sm"
              options={ARTIFACT_FILTERS.map((f) => ({
                id: f.id,
                label: f.label,
                badge: counts[f.id] ? <span className="font-num text-[10.5px] text-fg-3 tabular-nums">{counts[f.id]}</span> : undefined,
              }))}
            />
          </div>
        </PageToolbar>

        {res.error ? (
          <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote>
        ) : res.loading && !res.data ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon="layers" title={res.data?.length ? 'Nothing matches this search and filter' : 'No artifacts yet'}>
            {res.data?.length ? 'Try another search or filter.' : 'Ask for a report, audit or mockup and it lands here and in the thread’s side panel.'}
          </Empty>
        ) : layout === 'list' ? (
          <ul key={filter} className="rise divide-y divide-[var(--line)] overflow-hidden rounded-[var(--r-xl)] bg-surface" aria-label="Artifacts">
            {list.map((a, i) => (
              <li key={a.id} style={{ '--i': i } as CSSProperties}>
                <a href={href.thread(a.thread_id, a.id)} className="flex min-w-0 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-3 md:px-4">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg text-fg-3">
                    <Icon name={kindIcon(a.kind)} size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-[length:var(--fs-body)] font-medium">{artifactTitle(a.name)}</span>
                      {isNew(a) && <Chip tone="ink">New</Chip>}
                      {a.url && <Chip tone="outline">claude.ai</Chip>}
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[length:var(--fs-12)] text-fg-3">
                      <span className="min-w-0 truncate font-mono text-[length:var(--fs-code)]">{a.name}</span>
                      <span className="hidden min-w-0 truncate sm:inline" title={a.thread_title}>
                        #{channelName(a)} · {a.thread_title}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 font-num text-[length:var(--fs-meta)] text-fg-3">{relTime(a.updated_at)}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div key={filter} className="rise grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3 md:gap-4">
            {list.map((a, i) => (
              <a
                key={a.id}
                href={href.thread(a.thread_id, a.id)}
                style={{ '--i': i } as CSSProperties}
                className="group flex flex-col rounded-[var(--r-xl)] bg-surface p-1.5 transition-[transform,box-shadow,background-color] duration-300 [transition-timing-function:var(--ease-spring)] hover:-translate-y-0.5 hover:bg-elev hover:shadow-[var(--shadow-card)]"
              >
                <div className="relative aspect-[16/10] overflow-hidden rounded-[var(--r-lg)] bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">
                  <ArtifactThumb a={a} />
                  {isNew(a) && (
                    <span className="pop-in absolute top-2 left-2 inline-flex h-5 items-center gap-1 rounded-full bg-fg px-2 text-[10.5px] font-medium text-on-ink">
                      <span className="h-1 w-1 rounded-full bg-done" /> New
                    </span>
                  )}
                  {a.url && (
                    <span title="Published on claude.ai" className="absolute top-2 right-2 inline-flex h-5 items-center gap-1 rounded-full bg-elev px-2 text-[10.5px] font-medium text-fg-2 shadow-[var(--shadow-card)]">
                      <Icon name="globe" size={11} /> claude.ai
                    </span>
                  )}
                </div>
                <div className="min-w-0 px-2 pt-2.5 pb-1.5">
                  <div className="truncate text-[length:var(--fs-body)] font-medium" title={artifactTitle(a.name)}>
                    {artifactTitle(a.name)}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[length:var(--fs-code)] text-fg-3" title={a.name}>
                    {a.name}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[length:var(--fs-meta)] text-fg-3">
                    <span className="truncate" title={a.thread_title}>
                      #{channelName(a)} · {a.thread_title}
                    </span>
                    <span className="ml-auto shrink-0 font-num">{relTime(a.updated_at)}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
