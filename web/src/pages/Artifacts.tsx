import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { artifactUrl, useApi, type ArtifactWithThread } from '../api.ts';
import { kindIcon } from '../components/ArtifactViewer.tsx';
import { Empty, ErrorNote, Icon, Loading, PageHeader, Segmented } from '../components/ui.tsx';
import { relTime, toDate } from '../format.ts';
import { href } from '../router.ts';
import { readPref, useApp, useFeed, writePref } from '../store.tsx';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'html', label: 'Pages' },
  { id: 'image', label: 'Images' },
  { id: 'doc', label: 'Docs' },
  { id: 'data', label: 'Data' },
] as const;
type Filter = (typeof FILTERS)[number]['id'];

const matches = (f: Filter, kind: string) =>
  f === 'all' ||
  (f === 'html' && (kind === 'html' || kind === 'svg')) ||
  (f === 'image' && kind === 'image') ||
  (f === 'doc' && (kind === 'markdown' || kind === 'pdf' || kind === 'text')) ||
  (f === 'data' && (kind === 'csv' || kind === 'json'));

function Thumb({ a }: { a: ArtifactWithThread }) {
  if (a.kind === 'image' || a.kind === 'svg') {
    return <img src={artifactUrl(a)} alt="" loading="lazy" className="h-full w-full object-cover object-top" />;
  }
  if (a.kind === 'html') {
    // Scaled down, non-interactive live preview. Same sandbox as the viewer; lazy so offscreen cards cost nothing.
    return (
      <div className="pointer-events-none relative h-full w-full overflow-hidden bg-white">
        <iframe
          src={artifactUrl(a)}
          title=""
          tabIndex={-1}
          loading="lazy"
          sandbox="allow-scripts"
          className="absolute top-0 left-0 h-[400%] w-[400%] origin-top-left scale-25 border-0"
        />
      </div>
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center text-fg-4">
      <Icon name={kindIcon(a.kind)} size={28} strokeWidth={1.25} />
    </div>
  );
}

export function ArtifactsPage() {
  const { channel } = useApp();
  const res = useApi<ArtifactWithThread[]>('/artifacts');
  const [filter, setFilter] = useState<Filter>('all');

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

  const list = useMemo(() => (res.data ?? []).filter((a) => matches(filter, a.kind)), [res.data, filter]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, (res.data ?? []).filter((a) => matches(f.id, a.kind)).length])) as Record<Filter, number>, [res.data]);

  // "New" means changed since the previous visit to this page. The first visit marks nothing.
  const [seenAt] = useState(() => readPref<number | null>('artifacts.seen', null));
  useEffect(() => writePref('artifacts.seen', Date.now()), []);
  const isNew = (a: ArtifactWithThread) => seenAt != null && toDate(a.updated_at).getTime() > seenAt;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader title="Artifacts" subtitle="Pages, reports and files the crew produced, newest first." />
      <div className="px-4 pt-2 pb-16 md:px-8">
        <div className="scroll-thin mb-5 max-w-full overflow-x-auto">
          <Segmented
            label="Filter artifacts"
            value={filter}
            onChange={setFilter}
            size="sm"
            options={FILTERS.map((f) => ({
              id: f.id,
              label: f.label,
              badge: counts[f.id] ? <span className="font-num text-[10.5px] text-fg-4 tabular-nums">{counts[f.id]}</span> : undefined,
            }))}
          />
        </div>

        {res.error ? (
          <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote>
        ) : res.loading && !res.data ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon="layers" title={res.data?.length ? 'Nothing matches this filter' : 'No artifacts yet'}>
            Ask for a report, audit or mockup and it lands here and in the thread's side panel.
          </Empty>
        ) : (
          <div key={filter} className="rise grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3 md:gap-4">
            {list.map((a, i) => (
              <a
                key={a.id}
                href={href.thread(a.thread_id, a.id)}
                style={{ '--i': i } as CSSProperties}
                className="group flex flex-col rounded-[22px] bg-surface p-1.5 transition-[transform,box-shadow,background-color] duration-300 [transition-timing-function:var(--ease-spring)] hover:-translate-y-0.5 hover:bg-elev hover:shadow-[var(--shadow-card)]"
              >
                <div className="relative aspect-[16/10] overflow-hidden rounded-[16px] bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">
                  <Thumb a={a} />
                  {isNew(a) && (
                    <span className="pop-in absolute top-2 left-2 inline-flex h-5 items-center gap-1 rounded-full bg-fg px-2 text-[10.5px] font-medium text-on-ink">
                      <span className="h-1 w-1 rounded-full bg-done" /> New
                    </span>
                  )}
                </div>
                <div className="min-w-0 px-2 pt-2.5 pb-1.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Icon name={kindIcon(a.kind)} size={13} className="text-fg-3" />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{a.name}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-fg-3" title={a.thread_title}>
                    {a.thread_title}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-fg-4">
                    <span className="truncate">#{channel(a.channel_id)?.name ?? a.channel_id}</span>
                    <span className="ml-auto shrink-0 font-num text-[10.5px]">{relTime(a.updated_at)}</span>
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
