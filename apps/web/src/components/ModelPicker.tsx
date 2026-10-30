import { useEffect, useMemo, useRef, useState } from 'react';
import type { HarnessWithRunning } from '../api.ts';
import { Icon, Picker, type PickerOption } from './ui.tsx';
import { HarnessLogo } from './brand.tsx';
import { AUTO_CHOICE, asksAuto } from '../thread-run.ts';

export interface ModelChoice {
  harness: string;
  model: string;
}

const AUTO_NOTE = 'Picks a model for each task';
/** The open list's height: the search field and the 320px list. */
const LIST_HEIGHT = 380;

/** Under a thread the pill sits at the bottom of the page, so the list opens upward when it has no room below. */
function opensUp(btn: HTMLElement | null) {
  const r = btn?.getBoundingClientRect();
  return !!r && window.innerHeight - r.bottom < LIST_HEIGHT && r.top > window.innerHeight - r.bottom;
}

/**
 * One model pill whose list starts with Auto, then groups models under each harness, with a sticky header naming the
 * plan, one search across all groups, and the harness default marked "(default)". A harness that
 * isn't installed or logged in shows disabled with the command that fixes it. `onOpen` fires as
 * the list opens, so the caller can refetch and a fresh login shows up without a reload. With `effort`, the pill also
 * reads the effort ("Sonnet 5.5 · high") and the list ends with the picked model's levels, as the phone's model sheet.
 */
export function ModelPicker({
  harnesses,
  value,
  onChange,
  onOpen,
  defaultOpen,
  openRequest = 0,
  placeholder = 'Model',
  offerAuto = true,
  label,
  disabled,
  className = '',
  effort,
}: {
  harnesses: HarnessWithRunning[];
  value: ModelChoice;
  onChange: (v: ModelChoice) => void;
  onOpen?: () => void;
  /** Start with the list open. */
  defaultOpen?: boolean;
  /** Bumped to open the list, as `/model` in a thread's reply box does. */
  openRequest?: number;
  /** The pill's label when no model is picked. */
  placeholder?: string;
  /** List Auto first. A thread's own pill leaves it out: Auto picks the run as a thread starts. */
  offerAuto?: boolean;
  /** The pill's label in place of the picked model's name. */
  label?: string;
  disabled?: boolean;
  /** On the wrapper, around the pill and its list. */
  className?: string;
  /** The effort picked for `value`, "" for the model's default, and where a pick goes. */
  effort?: { value: string; onChange: (v: string) => void };
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [up, setUp] = useState(false);
  const [q, setQ] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  const auto = asksAuto(value);
  const current = useMemo(() => {
    const h = harnesses.find((x) => x.id === value.harness);
    const m = h?.models.find((x) => x.id === value.model);
    return { h, m };
  }, [harnesses, value]);

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    return harnesses.map((h) => ({
      harness: h,
      models: s
        ? h.models.filter((m) => `${m.label} ${m.id} ${h.name} ${h.plan}`.toLowerCase().includes(s))
        : h.models,
    }));
  }, [harnesses, q]);
  const showAuto = offerAuto && 'auto'.includes(q.trim().toLowerCase());

  useEffect(() => {
    if (defaultOpen) onOpen?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!openRequest) return;
    onOpen?.();
    setQ('');
    setUp(opensUp(btn.current));
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (v: ModelChoice) => {
    onChange(v);
    setOpen(false);
    btn.current?.focus();
  };

  const buttonLabel = label ?? (auto ? 'Auto' : current.m ? current.m.label : placeholder);
  const levels = effort && !auto ? modelOf(harnesses, value) : null;
  const effortShown = levels?.efforts.length ? effort!.value || levels.model?.defaultEffort || 'default' : null;

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        aria-label={
          auto
            ? 'Model: Auto'
            : `Model: ${label ?? current.m?.label ?? 'none'}${current.h ? ` on ${current.h.name}` : ''}${effortShown ? `, effort ${effortShown}` : ''}`
        }
        onClick={() => {
          if (!open) {
            onOpen?.();
            setUp(opensUp(btn.current));
          }
          setOpen(!open);
        }}
        className="press inline-flex h-8 max-w-full items-center gap-2 rounded-full bg-surface-2 pr-2.5 pl-1 text-[12.5px] font-medium text-fg transition-colors hover:bg-surface-3 disabled:opacity-45"
      >
        {current.h ? (
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bg text-fg">
            <HarnessLogo harness={current.h.id} size={13} />
          </span>
        ) : (
          <span className="grid h-6 w-6 shrink-0 place-items-center text-fg-3">
            <Icon name="zap" size={14} />
          </span>
        )}
        <span className="min-w-0 truncate">{buttonLabel}</span>
        {effortShown ? (
          <span className="shrink-0 text-fg-3">· {effortShown}</span>
        ) : (
          current.h && <span className="hidden shrink-0 text-fg-4 sm:inline">· {current.h.name}</span>
        )}
        <Icon name="chevronDown" size={13} className="text-fg-4" />
      </button>
      {open && (
        <div className={`pik-card w-[min(340px,calc(100vw-32px))] left-0 ${up ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'}`} data-up={up || undefined}>
          <label className="mb-1 flex h-10 items-center gap-2 rounded-2xl bg-surface px-3 text-fg-4">
            <Icon name="search" size={14} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a model or harness"
              aria-label="Find a model or harness"
              className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-4"
            />
          </label>
          <div role="listbox" aria-label="Model" className="scroll-thin max-h-[320px] overflow-y-auto outline-none">
            {showAuto && (
              <button type="button" role="option" aria-selected={auto} onClick={() => pick(AUTO_CHOICE)} className="pik-row">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-fg">
                  <Icon name="zap" size={13} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] text-fg">Auto</span>
                  <span className="truncate text-[11.5px] text-fg-4">{AUTO_NOTE}</span>
                </span>
                <span className="pik-mark">{auto && <Icon name="check" size={12} strokeWidth={2.6} />}</span>
              </button>
            )}
            {groups.map(({ harness, models }) => (
              <div key={harness.id}>
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-elev px-3 pt-2 pb-1">
                  <span className="caption flex min-w-0 items-center gap-1.5">
                    <HarnessLogo harness={harness.id} size={12} />
                    <span className="truncate">{harness.name}</span>
                  </span>
                  <span className="shrink-0 text-[11.5px] text-fg-4">
                    {harness.available ? (harness.plan.endsWith('plan') ? `Bills your ${harness.plan}` : harness.plan) : 'Unavailable'}
                  </span>
                </div>
                {!harness.available ? (
                  <div className="px-3 pb-2 text-[11.5px] text-fg-4">
                    {harness.fix && harness.fix.split(/\s+/).length <= 3 ? (
                      <>
                        Not available. Run <code className="font-mono text-fg-2">{harness.fix}</code>.
                      </>
                    ) : (
                      <>Not available. {harness.fix}</>
                    )}
                  </div>
                ) : models.length ? (
                  models.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={harness.id === value.harness && m.id === value.model}
                      onClick={() => pick({ harness: harness.id, model: m.id })}
                      className="pik-row"
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-fg">
                        <HarnessLogo harness={harness.id} size={13} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[13px] text-fg">
                          {m.label}
                          {m.default && <span className="text-fg-4"> (default)</span>}
                        </span>
                        {m.note && <span className="truncate text-[11.5px] text-fg-4">{m.note}</span>}
                      </span>
                      <span className="pik-mark">
                        {harness.id === value.harness && m.id === value.model && <Icon name="check" size={12} strokeWidth={2.6} />}
                      </span>
                    </button>
                  ))
                ) : q.trim() ? (
                  <div className="px-3 pb-2 text-[11.5px] text-fg-4">No match</div>
                ) : null}
              </div>
            ))}
          </div>
          {levels && levels.efforts.length > 0 && (
            <div className="mt-1 border-t border-line px-2 pt-2 pb-1">
              <div className="caption mb-1.5 px-1">Effort for {levels.model?.label ?? 'this model'}</div>
              <div role="radiogroup" aria-label="Effort" className="flex flex-wrap gap-1">
                {['', ...levels.efforts].map((e) => (
                  <button
                    key={e || 'default'}
                    type="button"
                    role="radio"
                    aria-checked={effort!.value === e}
                    onClick={() => {
                      effort!.onChange(e);
                      setOpen(false);
                      btn.current?.focus();
                    }}
                    className="press h-7 rounded-full px-2.5 text-[12px] text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg aria-checked:bg-fg aria-checked:text-on-ink"
                  >
                    {e || (levels.model?.defaultEffort ? `Default (${levels.model.defaultEffort})` : 'Default')}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The harness and model a choice runs, the harness default when none is picked, and that model's effort levels. */
export function modelOf(harnesses: HarnessWithRunning[], choice: ModelChoice) {
  const harness = harnesses.find((x) => x.id === choice.harness);
  const model = harness?.models.find((x) => x.id === choice.model) ?? (choice.model ? undefined : harness?.models.find((x) => x.default) ?? harness?.models[0]);
  return { harness, model, efforts: model?.efforts ?? [] };
}

/**
 * The effort pill for a model choice: "Default" plus the model's levels, or a disabled "Auto effort" when it has
 * none or Auto is picked. With no model picked, the levels are the harness default model's.
 */
export function EffortPicker({
  harnesses,
  choice,
  value,
  onChange,
  disabled,
  className,
}: {
  harnesses: HarnessWithRunning[];
  choice: ModelChoice;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { model: m, efforts } = modelOf(harnesses, choice);
  if (!efforts.length) {
    return <Picker label="Effort" value="" options={[{ value: '', label: 'Auto effort', avatar: false, icon: 'sliders' }]} onChange={() => {}} disabled />;
  }
  const options: PickerOption<string>[] = [
    { value: '', label: m?.defaultEffort ? `Default (${m.defaultEffort})` : 'Default', avatar: false, icon: 'sliders' },
    ...efforts.map((e) => ({ value: e, label: e, avatar: false as const, icon: 'sliders' as const })),
  ];
  return <Picker label="Effort" value={value} options={options} onChange={onChange} disabled={disabled} className={className} />;
}
