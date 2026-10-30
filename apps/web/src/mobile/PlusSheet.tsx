import { type HarnessWithRunning, type Thread } from '../api.ts';
import { HarnessLogo } from '../components/brand.tsx';
import { sourceRefusal } from '../continue.ts';
import { Icon, type IconName } from '../components/ui.tsx';
import { shownRun, threadRunLabels } from '../thread-run.ts';
import { MoGroup, MoListRow, MoSheet } from './parts.tsx';

export const PICK = { photo: 'image/*', camera: 'image/*', file: undefined } as const;
export type Pick = keyof typeof PICK;

/**
 * What the + opens: a photo, the camera or a file for the next message, and the thread's model and effort. Tapping
 * those opens the model sheet, which switches the run for the next turn, or once this one ends while it runs. A switch
 * queued that way shows here, with a row that drops it.
 */
export function PlusSheet({
  thread,
  harnesses,
  onPick,
  onFork,
  onRun,
  onKeep,
  onClose,
}: {
  thread: Thread;
  harnesses?: HarnessWithRunning[];
  onPick: (p: Pick) => void;
  onFork: () => void;
  onRun?: () => void;
  onKeep: () => void;
  onClose: () => void;
}) {
  const shown = shownRun(thread);
  const queued = shown !== thread;
  const labels = threadRunLabels(shown, harnesses);
  const now = threadRunLabels(thread, harnesses);
  const busy = thread.status === 'running' || thread.status === 'queued';
  const tiles: [Pick, IconName, string][] = [
    ['photo', 'image', 'Photo'],
    ['camera', 'maximize', 'Camera'],
    ['file', 'file', 'File'],
  ];
  return (
    <MoSheet onClose={onClose} label="Attach">
      <div className="grid grid-cols-3 gap-2 px-3 pt-3 pb-2.5">
        {tiles.map(([p, icon, label]) => (
          <button key={p} type="button" onClick={() => onPick(p)} className="mo-press flex h-[76px] flex-col items-center justify-center gap-2 rounded-[18px] bg-surface text-[13px]">
            <Icon name={icon} size={20} />
            {label}
          </button>
        ))}
      </div>
      <div className="px-3">
        <MoGroup>
          <MoListRow icon="branch" label="Fork thread" sub={sourceRefusal(thread.harness) ?? 'A new thread, on any harness, that picks up from here'} disabled={!!sourceRefusal(thread.harness)} onClick={onFork} />
        </MoGroup>
      </div>
      <div className="px-3 pt-2.5">
        <MoGroup>
          <MoListRow
            icon={<HarnessLogo harness={shown.harness} size={15} />}
            label={queued ? <span className="text-live-text">Next turn</span> : 'Model'}
            sub={labels.harnessName || undefined}
            right={labels.model}
            onClick={onRun}
          />
          <MoListRow icon="gauge" label="Effort" right={labels.effort} onClick={onRun} last={!queued} />
          {queued && <MoListRow icon="x" label={`Keep ${now.model}`} sub={`${now.harnessName ? `${now.harnessName}, ` : ''}${now.effort}`} onClick={onKeep} chevron={false} last />}
        </MoGroup>
        <p className="m-0 px-2 pt-2.5 text-[12.5px] leading-[1.45] text-fg-3">
          {queued
            ? `${labels.model} takes over when this turn ends. What you send now waits for it.`
            : busy
              ? 'A new model or effort takes over when this turn ends.'
              : 'A new model or effort takes over from the next message.'}
        </p>
      </div>
    </MoSheet>
  );
}
