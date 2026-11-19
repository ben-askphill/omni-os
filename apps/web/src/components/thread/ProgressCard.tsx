import { PROGRESS_MARK, progressCount, progressNow, progressPanel, progressTone, type ProgressPanel } from '@omni/shared/progress-panel.ts';
import { buildItems, type TranscriptEvent } from '@omni/shared/transcript-fold.ts';
import { useMemo, useState } from 'react';
import { readPref, writePref } from '../../store.tsx';
import { IconButton, StatusDot } from '../ui.tsx';
import { CARD_PAD, ROW_X } from './panel/inset.ts';

/** Where a closed card is remembered: thread id to the list it closed (ProgressPanel.key). */
const PREF = 'progress.closed';
/** How many closed threads it remembers, newest kept. */
const KEEP = 200;

const closedFor = (threadId: string) => readPref<Record<string, string>>(PREF, {})[threadId] ?? null;

function rememberClosed(threadId: string, key: string) {
  const all = readPref<Record<string, string>>(PREF, {});
  delete all[threadId];
  const kept = Object.entries(all).slice(-(KEEP - 1));
  writePref(PREF, Object.fromEntries([...kept, [threadId, key]]));
}

/** A step title's first line's middle: its row's top padding (--sp-3) plus half of a 12.5px line at 1.45. */
const MID = 'top-[15px]';
const RAIL = { first: `${MID} bottom-0 rounded-t-full`, mid: 'top-0 bottom-0', last: 'top-0 h-[15px] rounded-b-full' } as const;

/** The thread's Progress card list from its events, folded again only when they or its run state change. */
export function useProgressPanel(events: TranscriptEvent[], running: boolean, asking: boolean): ProgressPanel | null {
  return useMemo(() => progressPanel(buildItems(events).items, { live: running, asking }), [events, running, asking]);
}

const TEXT = { done: 'text-fg-3', current: 'font-medium text-fg', pending: 'text-fg-2' } as const;

/**
 * The thread's step list as a card under the quick card, like Claude's Progress card: a rail down the left, done steps
 * stepped back, a status mark on the step it is on. The X closes it for this list; a new list brings it back.
 */
export function ProgressCard({ threadId, panel, className = '' }: { threadId: string; panel: ProgressPanel | null; className?: string }) {
  const [closed, setClosed] = useState(() => closedFor(threadId));
  // The card remembers the thread it read the closed key for, so a switch to another thread reads that one's.
  const [readFor, setReadFor] = useState(threadId);
  if (readFor !== threadId) {
    setReadFor(threadId);
    setClosed(closedFor(threadId));
  }
  if (!panel || closed === panel.key) return null;
  const { view } = panel;
  const last = view.steps.length - 1;

  return (
    <section
      aria-label={`Progress, ${progressCount(view)}`}
      className={`w-full rounded-[var(--r-lg)] border border-line bg-surface ${CARD_PAD} shadow-[inset_0_0_0_1px_light-dark(transparent,var(--pane-edge))] ${className}`}
    >
      <div className={`flex h-9 items-center ${ROW_X} pr-[var(--sp-1)]`}>
        <h2 className="flex-1 text-[12.5px] font-medium text-fg">Progress</h2>
        <IconButton
          icon="x"
          label="Close progress"
          size={13}
          className="h-7 w-7"
          onClick={() => {
            rememberClosed(threadId, panel.key);
            setClosed(panel.key);
          }}
        />
      </div>
      <ol className={`${ROW_X} pb-[var(--sp-4)]`}>
        {view.steps.map((s, i) => {
          const tone = progressTone(s.state);
          const mark = PROGRESS_MARK[s.state];
          const now = progressNow(s);
          return (
            <li key={s.key} data-state={s.state} className="relative flex min-w-0 gap-[var(--sp-5)]" aria-current={tone === 'current' ? 'step' : undefined}>
              {/* The rail: one segment per step, darker through the done ones, from the first step's middle to the last's. */}
              <span aria-hidden className="relative w-[15px] shrink-0">
                {last > 0 && <span className={`absolute left-1/2 w-[2px] -translate-x-1/2 ${tone === 'done' ? 'bg-fg-4' : 'bg-line'} ${RAIL[i === 0 ? 'first' : i === last ? 'last' : 'mid']}`} />}
              </span>
              {mark && (
                <span className={`absolute ${MID} left-[7.5px] flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-surface p-[var(--sp-1)]`}>
                  <StatusDot mark={mark} size={8} />
                </span>
              )}
              <span className="min-w-0 flex-1 py-[var(--sp-3)] text-[12.5px] leading-[1.45]">
                <span className={`block ${TEXT[tone]}`}>{s.title}</span>
                {now && <span className="block truncate text-[11.5px] text-fg-3">{now}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
