import { useState } from 'react';
import { artifactUrl, type Artifact } from '../../../api.ts';
import { Empty, IconButton, Modal } from '../../ui.tsx';
import { fullDate, relTime } from '../../../format.ts';

export function Screenshots({ shots }: { shots: Artifact[] }) {
  const [open, setOpen] = useState<Artifact | null>(null);
  if (!shots.length) {
    return (
      <Empty icon="globe" title="No screenshots yet">
        When the agent takes a screenshot in the channel browser, it collects here.
      </Empty>
    );
  }
  const list = [...shots].reverse();
  const idx = open ? list.findIndex((s) => s.id === open.id) : -1;
  return (
    <div className="scroll-thin h-full overflow-y-auto px-2.5 pb-2.5">
      <div className="grid grid-cols-2 gap-2">
        {list.map((s) => (
          <button key={s.id} type="button" onClick={() => setOpen(s)} className="press group overflow-hidden rounded-2xl bg-bg p-1 text-left">
            <img src={artifactUrl(s)} alt={s.name} loading="lazy" className="aspect-[4/3] w-full rounded-xl object-cover object-top shadow-[inset_0_0_0_1px_var(--line)] transition-opacity group-hover:opacity-90" />
            <div className="truncate px-1.5 pt-1 pb-0.5 font-num text-[10.5px] text-fg-4">{relTime(s.updated_at)}</div>
          </button>
        ))}
      </div>
      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        wide
        title={
          open && (
            <span className="flex items-center gap-2">
              <span className="truncate">{open.name}</span>
              <span className="font-num text-[11px] text-fg-3">{fullDate(open.updated_at)}</span>
            </span>
          )
        }
      >
        {open && (
          <div className="relative bg-surface-2">
            <img src={artifactUrl(open)} alt={open.name} className="mx-auto max-h-[78vh] w-auto" />
            {idx > 0 && (
              <IconButton icon="chevronLeft" label="Newer" className="float absolute top-1/2 left-3 -translate-y-1/2" onClick={() => setOpen(list[idx - 1])} />
            )}
            {idx >= 0 && idx < list.length - 1 && (
              <IconButton icon="chevronRight" label="Older" className="float absolute top-1/2 right-3 -translate-y-1/2" onClick={() => setOpen(list[idx + 1])} />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
