import type { Artifact } from '../../../api.ts';
import { ArtifactViewer, kindIcon } from '../../ArtifactViewer.tsx';
import { Empty, Icon } from '../../ui.tsx';
import { relTime } from '../../../format.ts';

export function ArtifactsTab({ artifacts, selected, onSelect }: { artifacts: Artifact[]; selected: Artifact | undefined; onSelect: (id: number) => void }) {
  if (!artifacts.length) {
    return (
      <Empty icon="layers" title="No artifacts yet">
        Files the agent writes to its artifacts folder show up here and render inline.
      </Empty>
    );
  }
  const list = [...artifacts].reverse();
  return (
    <div className="flex h-full min-h-0 flex-col">
      {list.length > 1 && (
        <div className="scroll-thin max-h-[30%] shrink-0 overflow-y-auto px-2 pb-2">
          {list.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(a.id)}
              data-on={selected?.id === a.id || undefined}
              aria-pressed={selected?.id === a.id}
              className={`hov flex h-8 w-full min-w-0 items-center gap-2 rounded-full px-3 text-left text-[12.5px] [--hov:var(--surface-3)] ${selected?.id === a.id ? 'text-fg' : 'text-fg-2'}`}
            >
              <Icon name={kindIcon(a.kind)} size={13} className="text-fg-3" />
              <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
              <span className="shrink-0 font-num text-[10.5px] text-fg-4">{relTime(a.updated_at)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 bg-bg">{selected ? <ArtifactViewer key={selected.id} a={selected} /> : <div className="p-4 text-[13px] text-fg-3">Pick a file.</div>}</div>
    </div>
  );
}
