import { useMemo, useState } from 'react';
import type { ArtifactWithThread } from '../api.ts';
import { Segmented } from '../components/ui.tsx';
import { ARTIFACT_FILTERS, ArtifactThumb, matchesArtifactFilter, useArtifacts, type ArtifactFilter } from '../pages/Artifacts.tsx';
import { href } from '../router.ts';
import { useApp, useNow } from '../store.tsx';
import { MoEmpty, MoHeader, MoRound, MoScroll, MoStripes, MoTitle } from './parts.tsx';
import { shortTime } from './rows.ts';
import { useShell } from './shell.tsx';

/** Kinds whose preview is the file itself. The rest show stripes labelled with their extension. */
const DRAWN = new Set(['html', 'image', 'svg']);
const ext = (name: string) => (name.includes('.') ? name.split('.').pop()! : 'file');

function Card({ a, wide, channel, time, onOpen }: { a: ArtifactWithThread; wide: boolean; channel: string; time: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mo-press flex min-w-0 flex-col gap-2 rounded-[18px] bg-surface p-1.5 text-left"
      style={{ gridColumn: wide ? '1 / -1' : undefined }}
    >
      <div className="relative overflow-hidden rounded-[13px] bg-elev shadow-[var(--shadow-card)]" style={{ height: wide ? 170 : 110 }}>
        {DRAWN.has(a.kind) ? <ArtifactThumb a={a} scale={0.5} /> : <MoStripes label={ext(a.name)} />}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-1.5 pb-1.5">
        <span className="truncate font-mono text-[12.5px] leading-[1.3]">{a.name}</span>
        <span className="truncate text-[12px] leading-[1.3] text-fg-3">
          #{channel} · {time}
        </span>
      </div>
    </button>
  );
}

/** The Library tab: every file the crew made, newest first, the latest one full width. */
export function LibraryScreen() {
  const shell = useShell();
  const { channel } = useApp();
  const res = useArtifacts();
  const now = useNow(60_000);
  const [filter, setFilter] = useState<ArtifactFilter>('all');
  const list = useMemo(() => (res.data ?? []).filter((a) => matchesArtifactFilter(filter, a.kind)), [res.data, filter]);

  return (
    <>
      <MoHeader left={<span className="w-10" />} right={<MoRound icon="search" label="Search threads" onClick={() => shell.sheet({ name: 'search' })} />} />
      <MoScroll tabBar>
        <div>
          <MoTitle title="Library" sub="Reports, pages and files from every channel" />
          <div className="px-4">
            <Segmented label="Type" value={filter} onChange={setFilter} options={ARTIFACT_FILTERS.map((f) => ({ id: f.id, label: f.label }))} />
          </div>
        </div>
        {list.length ? (
          <div className="grid grid-cols-2 gap-2.5 px-4">
            {list.map((a, i) => (
              <Card
                key={a.id}
                a={a}
                wide={i === 0 && filter === 'all'}
                channel={channel(a.channel_id)?.name ?? a.channel_id}
                time={shortTime(a.updated_at, now)}
                onOpen={() => shell.open(href.thread(a.thread_id, a.id))}
              />
            ))}
          </div>
        ) : (
          <MoEmpty>
            {res.error ??
              (res.loading && !res.data
                ? 'Loading'
                : filter === 'all'
                  ? 'Nothing here yet. Reports, pages and files the crew writes show up here.'
                  : 'Nothing of this type yet.')}
          </MoEmpty>
        )}
      </MoScroll>
    </>
  );
}
