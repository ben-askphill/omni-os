import { useState } from 'react';
import { relTime } from '@omni/shared/format.ts';
import { artifactUrl, type Artifact, type ArtifactWithThread } from '../../../api.ts';
import { Empty, IconButton, Modal } from '../../ui.tsx';
import { fullDate } from '../../../format.ts';
import { href } from '../../../router.ts';

type Shot = Artifact | ArtifactWithThread;
const fromThread = (s: Shot) => ('thread_title' in s ? s.thread_title || 'Untitled' : null);

/**
 * The screenshots the agent took in the channel browser, newest first, then those of the threads it delegated to, each
 * tile naming its thread. The full view steps through both and links to the thread a delegated one came from.
 */
export function Screenshots({ shots, crew }: { shots: Artifact[]; crew: ArtifactWithThread[] }) {
  const [open, setOpen] = useState<Shot | null>(null);
  if (!shots.length && !crew.length) {
    return (
      <Empty icon="globe" title="No screenshots yet">
        When the agent takes a screenshot in the channel browser, it collects here, with those of the threads it delegates to.
      </Empty>
    );
  }
  const own = [...shots].reverse();
  const list: Shot[] = [...own, ...crew];
  const idx = open ? list.findIndex((s) => s.id === open.id) : -1;
  const from = open && fromThread(open);
  return (
    <div className="scroll-thin h-full overflow-y-auto px-2.5 pb-2.5">
      <Grid shots={own} onOpen={setOpen} />
      {crew.length > 0 && (
        <section aria-label="From delegated threads" className={own.length ? 'mt-3' : ''}>
          <div className="caption px-1.5 pb-1.5">From delegated threads</div>
          <Grid shots={crew} onOpen={setOpen} />
        </section>
      )}
      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        wide
        title={
          open && (
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{open.name}</span>
              <span className="shrink-0 font-num text-[11px] text-fg-3">{fullDate(open.updated_at)}</span>
              {from && (
                <a href={href.thread(open.thread_id)} title={`Open thread: ${from}`} className="truncate text-[12px] font-normal text-fg-3 underline decoration-line underline-offset-2 hover:text-fg">
                  from {from}
                </a>
              )}
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

function Grid({ shots, onOpen }: { shots: Shot[]; onOpen: (s: Shot) => void }) {
  if (!shots.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      {shots.map((s) => {
        const from = fromThread(s);
        return (
          <button key={s.id} type="button" onClick={() => onOpen(s)} title={from ? `${s.name}, from ${from}` : s.name} className="press group overflow-hidden rounded-2xl bg-bg p-1 text-left">
            <img src={artifactUrl(s)} alt={s.name} loading="lazy" className="aspect-[4/3] w-full rounded-xl object-cover object-top shadow-[inset_0_0_0_1px_var(--line)] transition-opacity group-hover:opacity-90" />
            <div className="flex min-w-0 items-center gap-1.5 px-1.5 pt-1 pb-0.5 text-[10.5px]">
              {from && <span className="min-w-0 flex-1 truncate text-fg-3">{from}</span>}
              <span className={`shrink-0 font-num text-fg-4 ${from ? '' : 'truncate'}`}>{relTime(s.updated_at)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
