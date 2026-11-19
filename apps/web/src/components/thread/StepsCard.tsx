// A turn's plain steps (@omni/shared/steps.ts), the transcript's progress view on desktop web and the desktop app: a
// status mark and a title per step, what the active step does now, and the threads a step handed work to. The calls
// themselves stay one click away, under each step's "N actions". A running turn shows it open under the transcript;
// a finished one folds to one line with Show steps.
import { useState } from 'react';
import type { Thread } from '../../api.ts';
import { href } from '../../router.ts';
import { actionsLabel, STEP_GLYPH, stepsHeader, type Step, type StepsView } from '@omni/shared/steps.ts';
import { Icon, StatusDot, StatusPill, Ticks } from '../ui.tsx';
import { ToolRow } from './ToolRows.tsx';

const CHEVRON = 'text-fg-3 transition-transform duration-300 [transition-timing-function:var(--ease-settle)]';

/** A delegated thread under its step: its title and state, opening it. */
function StepThread({ id, byId }: { id: string; byId: Map<string, Thread> }) {
  const t = byId.get(id);
  return (
    <a href={href.thread(id)} className="hov flex min-w-0 items-center gap-2 rounded-lg py-0.5 pr-1 text-[12.5px] text-fg-2 hover:text-fg">
      <Icon name="delegate" size={12} className="shrink-0 text-fg-3" />
      <span className="min-w-0 flex-1 truncate">{t ? `${t.role ? `${t.role[0].toUpperCase()}${t.role.slice(1)}: ` : ''}${t.title}` : 'A delegated thread'}</span>
      {t && <StatusPill status={t.status} />}
    </a>
  );
}

function StepRow({ s, cwd, running, byId }: { s: Step; cwd?: string | null; running: boolean; byId: Map<string, Thread> }) {
  const [open, setOpen] = useState(false);
  const on = s.state === 'active' || s.state === 'needs';
  return (
    <li data-state={s.state} className="py-[5px]">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="grid h-[19px] w-3 shrink-0 place-items-center">
          <StatusDot status={STEP_GLYPH[s.state]} size={8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[13.5px] leading-[1.4] break-words ${on ? 'font-medium text-fg' : s.state === 'pending' ? 'text-fg-3' : 'text-fg-2'}`}>{s.title}</span>
          {s.now && <span className="block text-[12.5px] leading-[1.4] break-words text-fg-3">Now: {s.now}</span>}
        </span>
        {s.actions > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="hov press inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 font-num text-[11.5px] text-fg-3 hover:text-fg"
          >
            {actionsLabel(s.actions)}
            <Icon name="chevronRight" size={11} className={`${CHEVRON} ${open ? 'rotate-90' : ''}`} />
          </button>
        )}
      </div>
      {s.threads.length > 0 && (
        <div className="mt-1 ml-[22px] space-y-0.5">
          {s.threads.map((id) => (
            <StepThread key={id} id={id} byId={byId} />
          ))}
        </div>
      )}
      {open && (
        <div className="fade-in mt-1.5 ml-[14px] rounded-[16px] bg-surface p-1">
          {s.calls.map((c) => (
            <ToolRow key={c.id} c={c} cwd={cwd} running={running} />
          ))}
        </div>
      )}
    </li>
  );
}

export function StepsCard({ v, cwd, byId }: { v: StepsView; cwd?: string | null; byId: Map<string, Thread> }) {
  const [shown, setShown] = useState(false);
  const open = v.live || shown;
  const n = v.steps.length;
  const failed = v.steps.some((s) => s.state === 'failed');
  return (
    <section aria-label="Steps" data-live={v.live || undefined} className="rounded-[20px] px-4 pt-3 pb-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
      {v.live ? (
        <div className="mb-1.5 flex items-center gap-3">
          <span className="caption">{stepsHeader(v)}</span>
          {v.source !== 'phases' && <Ticks value={n ? v.done / n : 0} count={Math.max(1, n)} height={6} className="max-w-40 flex-1" label="Step progress" />}
          {v.actions > 0 && <span className="ml-auto font-num text-[11px] text-fg-3 tabular-nums">{actionsLabel(v.actions)}</span>}
        </div>
      ) : (
        <button type="button" onClick={() => setShown((o) => !o)} aria-expanded={open} className="hov -mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center gap-2 rounded-xl px-2 py-1 text-left text-[12.5px]">
          <StatusDot status={failed ? 'failed' : v.steps.every((s) => s.state === 'done') ? 'done' : 'settled'} size={8} />
          <span className="min-w-0 flex-1 truncate font-medium text-fg-2">
            {stepsHeader(v)}
            {v.actions > 0 && <span className="font-normal text-fg-3"> · {actionsLabel(v.actions)}</span>}
          </span>
          <span className="shrink-0 text-fg-3">{open ? 'Hide steps' : 'Show steps'}</span>
          <Icon name="chevronRight" size={12} className={`${CHEVRON} ${open ? 'rotate-90' : ''}`} />
        </button>
      )}
      {open && (
        <ol className={v.live ? '' : 'fade-in mt-1'}>
          {v.steps.map((s) => (
            <StepRow key={s.key} s={s} cwd={cwd} running={v.live} byId={byId} />
          ))}
        </ol>
      )}
    </section>
  );
}
