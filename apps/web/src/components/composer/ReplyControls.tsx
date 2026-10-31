import { MOD } from './controls.tsx';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { api, errorText, useApi, type HarnessWithRunning, type SendMode, type Thread } from '../../api.ts';
import { Icon, Kbd, Loader, type IconName } from '../ui.tsx';
import { ModelPicker } from '../ModelPicker.tsx';
import { currentRun, pickedRun, shownRun, threadChoice, threadRunLabels, type RunPick } from '../../thread-run.ts';
import type { Run } from '@omni/shared/run-switch.ts';



const SEND_OPTIONS: { mode: SendMode; label: string; hint: string; icon: IconName; keys?: string[] }[] = [
  { mode: 'steer', label: 'Steer now', hint: 'The agent reads it at its next step', icon: 'send', keys: ['Enter'] },
  { mode: 'queue', label: 'Queue for after this turn', hint: 'Runs when the current turn ends', icon: 'clock' },
  { mode: 'interrupt', label: 'Interrupt and send', hint: 'Stops the current step, then runs this', icon: 'stop', keys: [MOD, 'Shift', 'Enter'] },
];

const halfCls = 'inline-flex h-[34px] items-center bg-fg text-on-ink transition-[opacity,transform] duration-150 ease-out select-none active:scale-[.92] disabled:opacity-25';

/** Split button for a busy thread: Steer (or Queue when the harness can't steer), plus a menu. */
export function SteerButton({ disabled, busy, canSteer = true, onSend }: { disabled: boolean; busy: boolean; canSteer?: boolean; onSend: (mode: SendMode) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (disabled || busy) setOpen(false);
  }, [disabled, busy]);

  useEffect(() => {
    if (!open) return;
    items.current[0]?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    // The thread page skips its Esc-to-interrupt while a [role=menu] is open, so this only closes the menu.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onMenuKey = (e: ReactKeyboardEvent) => {
    const list = items.current.filter((b): b is HTMLButtonElement => !!b);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (k: number) => {
      e.preventDefault();
      list[(k + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  };

  const options = canSteer ? SEND_OPTIONS : SEND_OPTIONS.filter((o) => o.mode !== 'steer');
  const primary: SendMode = canSteer ? 'steer' : 'queue';
  return (
    <div ref={wrap} className="relative flex">
      <button type="button" onClick={() => onSend(primary)} disabled={disabled || busy} className={`${halfCls} gap-1.5 rounded-l-full pr-2.5 pl-3.5 text-[13px] font-medium whitespace-nowrap`}>
        {busy ? <Loader size={16} /> : <Icon name={canSteer ? 'send' : 'clock'} size={16} strokeWidth={2} />}
        {canSteer ? 'Steer' : 'Queue'}
      </button>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More ways to send"
        title="More ways to send"
        disabled={disabled || busy}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`${halfCls} w-8 justify-center rounded-r-full border-l border-on-ink/25 pr-0.5`}
      >
        <Icon name="chevronDown" size={13} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Send options"
          onKeyDown={onMenuKey}
          className="fade-in absolute right-0 bottom-full z-20 mb-1.5 w-72 max-w-[calc(100vw-1.5rem)] sm:w-80 rounded-[22px] bg-elev p-1.5 shadow-[var(--shadow-menu)]"
        >
          {options.map((o, k) => (
            <button
              key={o.mode}
              ref={(el) => {
                items.current[k] = el;
              }}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSend(o.mode);
              }}
              className="flex min-h-10 w-full min-w-0 items-start gap-2.5 rounded-2xl px-3 py-2 text-left outline-none hover:bg-[var(--wash)] focus:bg-[var(--wash)]"
            >
              <Icon name={o.icon} size={14} className="mt-[3px] text-fg-3" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-[13px] text-fg">{o.label}</span>
                  {o.keys && (
                    <span className="hidden shrink-0 items-center gap-0.5 sm:flex">
                      {o.keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </span>
                  )}
                </span>
                <span className="block text-[11.5px] text-fg-4">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const finePointer = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches;

/**
 * The thread's model and effort. Picking either switches the run for the next turn: the server answers with the
 * thread, or says why not. While a turn runs the pick waits for it (`queued_*`), so the pills show it with a "Next
 * turn" chip whose x drops it.
 */
export function ThreadRunPills({
  thread,
  openRequest,
  onSwitched,
  onError,
}: {
  thread: Thread;
  /** Bumped to open the model list: `/model`, `/effort` and `/fast`. */
  openRequest: number;
  onSwitched: (t: Thread) => void;
  onError: (text: string | null) => void;
}) {
  const { data: harnesses, reload } = useApi<HarnessWithRunning[]>('/harnesses');
  const [switching, setSwitching] = useState(false);
  const shown = shownRun(thread);
  const queued = shown !== thread;
  const labels = threadRunLabels(shown, harnesses);
  const choice = threadChoice(shown, harnesses);

  const post = async (run: Run | null) => {
    if (!run || switching) return;
    setSwitching(true);
    onError(null);
    try {
      onSwitched(await api.post<Thread>(`/threads/${encodeURIComponent(thread.id)}/run`, run));
    } catch (e) {
      onError(errorText(e));
    } finally {
      setSwitching(false);
    }
  };
  const pick = (p: RunPick) => void post(pickedRun(shown, harnesses, p));

  if (!harnesses) return null;
  const now = threadRunLabels(thread, harnesses);
  const busy = thread.status === 'running' || thread.status === 'queued';
  const ring = queued ? 'rounded-full ring-1 ring-live' : '';
  return (
    <span title={busy && !queued ? 'A pick now applies when this turn ends' : (shown.auto_reason ?? undefined)} className="inline-flex max-w-full items-center gap-1.5">
      {queued && (
        <button
          type="button"
          disabled={switching}
          onClick={() => void post(currentRun(thread))}
          title={`Runs on ${now.model}, ${now.effort} until this turn ends. Click to keep it.`}
          aria-label={`Next turn runs on ${labels.model}, ${labels.effort}. Keep ${now.model}, ${now.effort}`}
          className="press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface-2 pr-2 pl-2.5 text-[12px] font-semibold text-live-text transition-colors hover:bg-surface-3 disabled:opacity-45"
        >
          <Icon name="clock" size={13} />
          Next turn
          <Icon name="x" size={12} className="text-fg-4" />
        </button>
      )}
      <ModelPicker
        harnesses={harnesses}
        onOpen={reload}
        openRequest={openRequest}
        offerAuto={false}
        label={labels.model}
        value={choice}
        disabled={switching}
        className={ring}
        onChange={(c) => pick(c)}
        effort={{ value: shown.effort, onChange: (effort) => pick({ effort }) }}
      />
    </span>
  );
}
