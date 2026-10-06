import { useEffect, useMemo, useRef, useState } from 'react';
import type { HarnessWithRunning, ModelEntry } from '../api.ts';
import { Icon, Picker, type PickerOption } from './ui.tsx';
import { HarnessLogo } from './brand.tsx';

export interface ModelChoice {
  harness: string;
  model: string;
}

/**
 * One model pill whose list groups models under each harness, with a sticky header naming the
 * plan, one search across all groups, and the harness default marked "(default)". A harness that
 * isn't installed or logged in shows disabled with the command that fixes it. `onOpen` fires as
 * the list opens, so the caller can refetch and a fresh login shows up without a reload.
 */
export function ModelPicker({
  harnesses,
  value,
  onChange,
  onOpen,
  defaultOpen,
  placeholder = 'Model',
}: {
  harnesses: HarnessWithRunning[];
  value: ModelChoice;
  onChange: (v: ModelChoice) => void;
  onOpen?: () => void;
  /** Start with the list open, as "New thread on another model" does. */
  defaultOpen?: boolean;
  /** The pill's label when no model is picked. */
  placeholder?: string;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [q, setQ] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    if (defaultOpen) onOpen?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (harness: string, m: ModelEntry) => {
    onChange({ harness, model: m.id });
    setOpen(false);
    btn.current?.focus();
  };

  const buttonLabel = current.m ? current.m.label : placeholder;

  return (
    <div ref={wrap} className="relative">
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Model: ${current.m?.label ?? 'none'}${current.h ? ` on ${current.h.name}` : ''}`}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
        className="press inline-flex h-8 max-w-full items-center gap-2 rounded-full bg-surface-2 pr-2.5 pl-1 text-[12.5px] font-medium text-fg transition-colors hover:bg-surface-3"
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
        {current.h && <span className="hidden shrink-0 text-fg-4 sm:inline">· {current.h.name}</span>}
        <Icon name="chevronDown" size={13} className="text-fg-4" />
      </button>
      {open && (
        <div className="pik-card w-[min(340px,calc(100vw-32px))] top-[calc(100%+8px)] left-0">
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
                      onClick={() => pick(harness.id, m)}
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
        </div>
      )}
    </div>
  );
}

/**
 * The effort pill for a model choice: "Default" plus the model's levels, or a disabled "Auto effort" when it has
 * none. With no model picked, the levels are the harness default model's.
 */
export function EffortPicker({ harnesses, choice, value, onChange }: { harnesses: HarnessWithRunning[]; choice: ModelChoice; value: string; onChange: (v: string) => void }) {
  const h = harnesses.find((x) => x.id === choice.harness);
  const m = h?.models.find((x) => x.id === choice.model) ?? (choice.model ? undefined : h?.models.find((x) => x.default) ?? h?.models[0]);
  const efforts = m?.efforts ?? [];
  if (!efforts.length) {
    return <Picker label="Effort" value="" options={[{ value: '', label: 'Auto effort', avatar: false, icon: 'sliders' }]} onChange={() => {}} disabled />;
  }
  const options: PickerOption<string>[] = [
    { value: '', label: m?.defaultEffort ? `Default (${m.defaultEffort})` : 'Default', avatar: false, icon: 'sliders' },
    ...efforts.map((e) => ({ value: e, label: e, avatar: false as const, icon: 'sliders' as const })),
  ];
  return <Picker label="Effort" value={value} options={options} onChange={onChange} />;
}
