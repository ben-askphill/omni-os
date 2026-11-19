import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { effortWord, term } from '@omni/shared/display.ts';
import { useTechnical } from '../display.ts';
import type { HarnessWithRunning } from '../api.ts';
import type { PickerAccounts } from '../accounts.ts';
import { Icon, Picker, type PickerOption } from './ui.tsx';
import { HarnessLogo } from './brand.tsx';
import { ModelList, listedChoices } from './model-picker/ModelList.tsx';
import { useAnchoredPopover } from './ui/use-anchored-popover.ts';
import { useListbox } from './ui/use-listbox.ts';
import { asksAuto } from '@omni/shared/thread-run.ts';
import { pickerModels } from '@omni/shared/model-visibility.ts';

export interface ModelChoice {
  harness: string;
  model: string;
}

/**
 * One model pill whose list starts with Auto, then groups models under each harness, with a sticky header naming the
 * plan, one search across all groups, and the harness default marked "(default)". Models hidden in Settings > Harnesses
 * & models are left out, unless one is the model already picked. A harness that
 * isn't installed or logged in shows disabled with the command that fixes it. `onOpen` fires as
 * the list opens, so the caller can refetch and a fresh login shows up without a reload. With `effort`, the pill also
 * reads the effort ("Sonnet 5.5 · high") and the list ends with the picked model's levels, as the phone's model sheet.
 *
 * The list is a top-layer popover tethered to the pill, as the shared Picker's: under a thread the pill sits at the
 * bottom of the page, so it opens upward when there is no room below. The search field is a combobox: the arrow keys,
 * Enter and Escape work from it, and `aria-activedescendant` names the model under the cursor.
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
  accounts,
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
  /** Who each harness runs as on the machine the thread runs on (GET /api/accounts). */
  accounts?: PickerAccounts | null;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [q, setQ] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  /** The list opened from the keyboard, so its cursor shows the focus ring. */
  const openedByKey = useRef(false);

  const auto = asksAuto(value);
  const current = useMemo(() => {
    const h = harnesses.find((x) => x.id === value.harness);
    const m = h?.models.find((x) => x.id === value.model);
    return { h, m };
  }, [harnesses, value]);

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    return harnesses.map((h) => {
      // Models hidden in Settings stay out, except the one already picked.
      const listed = pickerModels(h.models, h.id === value.harness ? value.model : null);
      return {
        harness: h,
        models: s ? listed.filter((m) => `${m.label} ${m.id} ${h.name} ${h.plan}`.toLowerCase().includes(s)) : listed,
      };
    });
  }, [harnesses, q, value]);
  const showAuto = offerAuto && 'auto'.includes(q.trim().toLowerCase());
  const choices = listedChoices(groups, showAuto);
  const list = useListbox(choices.length, open);
  const pop = useAnchoredPopover({ open, onDismiss: () => setOpen(false), wrap, trigger: btn, panel: card, initialFocus: () => search.current });

  // On the picked model as the list opens. The search is empty by then, so the choices are the whole list.
  useLayoutEffect(() => {
    if (!open) return;
    list.reset(Math.max(0, choices.findIndex((c) => c.harness === value.harness && c.model === value.model)), openedByKey.current);
    openedByKey.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (defaultOpen) onOpen?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!openRequest) return;
    onOpen?.();
    setQ('');
    openedByKey.current = true;
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  const openList = (byKey: boolean) => {
    onOpen?.();
    setQ('');
    openedByKey.current = byKey;
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  const pick = (v: ModelChoice) => {
    onChange(v);
    close();
  };

  const technical = useTechnical();
  const buttonLabel = label ?? (auto ? 'Auto' : current.m ? current.m.label : placeholder);
  const levels = effort && !auto ? modelOf(harnesses, value) : null;
  const effortLevel = levels?.efforts.length ? effort!.value || levels.model?.defaultEffort || 'default' : null;
  const effortShown = effortLevel && effortWord(effortLevel, technical);

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? list.listId : undefined}
        disabled={disabled}
        aria-label={
          auto
            ? 'Model: Auto'
            : `Model: ${label ?? current.m?.label ?? 'none'}${current.h ? ` on ${current.h.name}` : ''}${effortShown ? `, ${term('effort', technical).toLowerCase()} ${effortShown}` : ''}`
        }
        {...pop.triggerProps}
        onClick={(e) => (pop.clickCloses() ? close() : openList(e.detail === 0))}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            openList(true);
          }
        }}
        className="press inline-flex h-8 max-w-full items-center gap-2 rounded-full bg-surface-2 pr-2.5 pl-1 text-[12.5px] text-fg transition-colors hover:bg-surface-3 disabled:opacity-45"
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
          current.h && <span className="hidden shrink-0 text-fg-3 sm:inline">· {current.h.name}</span>
        )}
        <Icon name="chevronDown" size={13} className="text-fg-3" />
      </button>
      {open && (
        <div
          ref={card}
          {...pop.panelProps}
          className={`pik-card w-[min(340px,calc(100vw-32px))] ${pop.inlineClass}`}
          data-keys={list.keyed || undefined}
          // Escape from anywhere in the list, the effort levels too; the search field's own keys run first.
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            close();
          }}
          // Tab or Shift+Tab out of it closes it, as the shared Picker's Tab does. A press on its own padding moves the
          // focus nowhere and leaves it open.
          onBlur={(e) => {
            if (e.relatedTarget && !card.current?.contains(e.relatedTarget)) close(false);
          }}
        >
          <label className="mb-1 flex h-10 items-center gap-2 rounded-2xl bg-surface px-3 text-fg-3">
            <Icon name="search" size={14} />
            <input
              ref={search}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                list.reset(0, list.keyed);
              }}
              onKeyDown={(e) => {
                list.onKeyDown(e, {
                  onPick: (i) => choices[i] && pick(choices[i]),
                  onClose: (refocus) => refocus && close(),
                });
              }}
              role="combobox"
              aria-expanded="true"
              aria-controls={list.listId}
              aria-autocomplete="list"
              aria-activedescendant={list.cursor >= 0 ? list.optionId(list.cursor) : undefined}
              placeholder={term('findModel', technical)}
              aria-label={term('findModel', technical)}
              className="field-sm h-full min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-4"
            />
          </label>
          <ModelList
            groups={groups}
            showAuto={showAuto}
            auto={auto}
            value={value}
            query={q}
            onPick={pick}
            accounts={accounts}
            listId={list.listId}
            optionId={list.optionId}
            cursor={list.cursor}
            onHover={list.hover}
            scroller={list.scroller}
          />
          {levels && levels.efforts.length > 0 && (
            <div className="mt-1 border-t border-line px-2 pt-2 pb-1">
              <div className="caption mb-1.5 px-1">
                {term('effortFor', technical)} {levels.model?.label ?? 'this model'}
              </div>
              <div role="radiogroup" aria-label={term('effort', technical)} className="flex flex-wrap gap-1">
                {['', ...levels.efforts].map((e) => (
                  <button
                    key={e || 'default'}
                    type="button"
                    role="radio"
                    aria-checked={effort!.value === e}
                    onClick={() => {
                      effort!.onChange(e);
                      close();
                    }}
                    className="press h-7 rounded-full px-2.5 text-[12px] text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg aria-checked:bg-fg aria-checked:text-on-ink"
                  >
                    {e ? effortWord(e, technical) : levels.model?.defaultEffort ? `Default (${effortWord(levels.model.defaultEffort, technical)})` : 'Default'}
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
