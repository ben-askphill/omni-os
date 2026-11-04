import { relTime } from '@omni/shared/format.ts';
import type { Artifact, ArtifactWithThread } from '../../../api.ts';
import { ArtifactViewer, kindIcon } from '../../ArtifactViewer.tsx';
import { Empty, Icon } from '../../ui.tsx';

/**
 * The thread's files over the one picked, newest first. Under them, the files of the threads it delegated to, at any
 * depth, each row naming the thread it came from. The viewer links to that thread.
 */
export function ArtifactsTab({ artifacts, crew, selected, onSelect }: { artifacts: Artifact[]; crew: ArtifactWithThread[]; selected: Artifact | ArtifactWithThread | undefined; onSelect: (id: number) => void }) {
  if (!artifacts.length && !crew.length) {
    return (
      <Empty icon="layers" title="No artifacts yet">
        Files the agent writes to its artifacts folder show up here and render inline, with those of the threads it delegates to.
      </Empty>
    );
  }
  const list = [...artifacts].reverse();
  const from = selected && 'thread_title' in selected ? { id: selected.thread_id, title: selected.thread_title } : undefined;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {(list.length > 1 || crew.length > 0) && (
        <div className="scroll-thin max-h-[30%] shrink-0 overflow-y-auto px-2 pb-2">
          {list.map((a) => (
            <Row key={a.id} a={a} on={selected?.id === a.id} onSelect={onSelect} />
          ))}
          {crew.length > 0 && (
            <section aria-label="From delegated threads">
              <div className={`caption px-3 pb-1 ${list.length ? 'pt-2.5' : ''}`}>From delegated threads</div>
              {crew.map((a) => (
                <Row key={a.id} a={a} thread={a.thread_title || 'Untitled'} on={selected?.id === a.id} onSelect={onSelect} />
              ))}
            </section>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 bg-bg">{selected ? <ArtifactViewer key={selected.id} a={selected} from={from} /> : <div className="p-4 text-[13px] text-fg-3">Pick a file.</div>}</div>
    </div>
  );
}

function Row({ a, thread, on, onSelect }: { a: Artifact; thread?: string; on: boolean; onSelect: (id: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(a.id)}
      data-on={on || undefined}
      aria-pressed={on}
      title={thread ? `${a.name}, from ${thread}` : a.name}
      className={`hov flex h-8 w-full min-w-0 items-center gap-2 rounded-full px-3 text-left text-[12.5px] [--hov:var(--surface-3)] ${on ? 'text-fg' : 'text-fg-2'}`}
    >
      <Icon name={kindIcon(a.kind)} size={13} className="text-fg-3" />
      <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
      {thread && <span className="max-w-[45%] shrink truncate text-[11px] text-fg-3">{thread}</span>}
      <span className="shrink-0 font-num text-[10.5px] text-fg-4">{relTime(a.updated_at)}</span>
    </button>
  );
}
