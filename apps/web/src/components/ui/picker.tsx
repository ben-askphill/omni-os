import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons.tsx';
import { Avatar } from './primitives.tsx';
import { useAnchoredPopover } from './use-anchored-popover.ts';
import { useListbox } from './use-listbox.ts';
import { useExit } from './use-exit.ts';

// ---------- picker (Bencho "pik") ----------

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  sub?: string;
  icon?: IconName;
  /** Letter avatar seed; defaults to the label. Set `avatar: false` to hide it. */
  avatar?: string | false;
  /** A channel icon for the avatar in place of the letter. */
  avatarBg?: string | null;
  channelIcon?: string | null;
  /** The Conductor's channel: its avatar draws the Omni mark until it has an icon of its own. */
  omni?: boolean;
  /** A mark to lead with instead of the avatar (a HarnessLogo or CrewMark). */
  lead?: ReactNode;
  /** A face of its own in place of the letter avatar, drawn at the size the row asks for (an agent's AgentAvatar). */
  face?: (size: number) => ReactNode;
  /** Listed but not pickable now, with `sub` saying why (a machine that is offline). */
  disabled?: boolean;
}


/**
 * A pill or field that opens a list to pick one option from. The list is a top-layer popover tethered to the pill
 * (`useAnchoredPopover`), so it shows whole inside a modal. With a search field (`searchable`, or more than seven
 * options) the field is a combobox; without, the list takes the focus. Either way `aria-activedescendant` names the
 * option under the cursor, so a screen reader reads it as the arrow keys move.
 */
export function Picker<T extends string>({
  value,
  options,
  onChange,
  label,
  prefix,
  searchable,
  disabled,
  className = '',
  align = 'left',
  size = 'pill',
  id,
  describedBy,
}: {
  value: T;
  options: PickerOption<T>[];
  onChange: (v: T) => void;
  label: string;
  prefix?: ReactNode;
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
  align?: 'left' | 'right';
  /** `field`: as tall and wide as a text field, for a form; `pill`: a compact pill in a line of text or a toolbar. */
  size?: 'pill' | 'field';
  id?: string;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const current = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(s)) : options;
  }, [options, q]);
  const canSearch = searchable ?? options.length > 7;
  const list = useListbox(shown.length, open);
  const exit = useExit(open, card);
  const pop = useAnchoredPopover({
    open,
    onDismiss: () => setOpen(false),
    wrap,
    trigger: btn,
    panel: card,
    align,
    initialFocus: () => (canSearch ? search.current : list.scroller.current),
  });

  const openMenu = (byKey: boolean) => {
    if (disabled) return;
    setQ('');
    list.reset(Math.max(0, options.findIndex((o) => o.value === value)), byKey);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  const pick = (o: PickerOption<T>) => {
    onChange(o.value);
    close();
  };
  const active = open && list.cursor >= 0 ? list.optionId(list.cursor) : undefined;

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <button
        ref={btn}
        id={id}
        type="button"
        aria-describedby={describedBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? list.listId : undefined}
        aria-label={`${label}: ${current?.label ?? 'none'}`}
        disabled={disabled}
        {...pop.triggerProps}
        // A click from the keyboard (Enter or Space) has no pointer, so its list shows the cursor's focus ring.
        onClick={(e) => (pop.clickCloses() ? close() : openMenu(e.detail === 0))}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            openMenu(true);
          }
        }}
        className={
          size === 'field'
            ? 'press flex h-10 w-full min-w-0 items-center gap-2 rounded-[14px] bg-surface pr-3 pl-2 text-left text-[14px] text-fg shadow-[inset_0_0_0_1px_var(--line)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--line-strong)] disabled:opacity-45'
            : 'press inline-flex h-8 max-w-full items-center gap-2 rounded-full bg-surface-2 pr-2.5 pl-1 text-[12.5px] text-fg transition-colors hover:bg-surface-3 disabled:opacity-45'
        }
      >
        {current?.face ? (
          current.face(24)
        ) : current?.lead ? (
          <span className="grid h-6 w-6 place-items-center rounded-full bg-bg text-fg">{current.lead}</span>
        ) : current && current.avatar !== false ? (
          <Avatar name={current.avatar || current.label} icon={current.icon} omni={current.omni} channelIcon={current.channelIcon} avatarBg={current.avatarBg} size={24} />
        ) : current?.icon ? (
          <span className="grid h-6 w-6 place-items-center text-fg-3">
            <Icon name={current.icon} size={14} />
          </span>
        ) : (
          <span className="w-1.5" />
        )}
        {prefix && <span className="-mr-1 text-fg-3">{prefix}</span>}
        <span className={`min-w-0 truncate ${size === 'field' ? 'flex-1' : ''}`}>{current?.label ?? 'Choose'}</span>
        <Icon name="chevronDown" size={13} className="pik-chev text-fg-3" />
      </button>
      {exit.shown && (
        <div
          ref={card}
          {...pop.panelProps}
          data-closing={exit.closing || undefined}
          className={`pik-card w-[min(300px,calc(100vw-32px))] ${pop.inlineClass}`}
          data-keys={list.keyed || undefined}
          onKeyDown={(e) =>
            list.onKeyDown(e, {
              onPick: (i) => {
                const o = shown[i];
                if (o && !o.disabled) pick(o);
              },
              onClose: close,
              homeEnd: !canSearch,
              space: !canSearch,
            })
          }
        >
          {canSearch && (
            <label className="mb-1 flex h-10 items-center gap-2 rounded-2xl bg-surface px-3 text-fg-3">
              <Icon name="search" size={14} />
              <input
                ref={search}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  list.reset(0, list.keyed);
                }}
                role="combobox"
                aria-expanded="true"
                aria-controls={list.listId}
                aria-autocomplete="list"
                aria-activedescendant={active}
                placeholder={`Find ${label.toLowerCase()}`}
                aria-label={`Find ${label.toLowerCase()}`}
                className="field-sm h-full min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-4"
              />
            </label>
          )}
          <div
            ref={list.scroller}
            id={list.listId}
            role="listbox"
            aria-label={label}
            aria-activedescendant={canSearch ? undefined : active}
            tabIndex={-1}
            className="scroll-thin max-h-[280px] overflow-y-auto outline-none"
          >
            {shown.map((o, i) => (
              <button
                key={o.value}
                id={list.optionId(i)}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                disabled={o.disabled}
                data-cursor={i === list.cursor}
                onMouseMove={() => list.hover(i)}
                onClick={() => pick(o)}
                className="pik-row disabled:opacity-45"
              >
                {o.face ? (
                  o.face(28)
                ) : o.lead ? (
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-fg">{o.lead}</span>
                ) : o.avatar !== false ? (
                  <Avatar name={o.avatar || o.label} icon={o.icon} omni={o.omni} channelIcon={o.channelIcon} avatarBg={o.avatarBg} size={28} />
                ) : o.icon ? (
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-2 text-fg-3">
                    <Icon name={o.icon} size={14} />
                  </span>
                ) : null}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] text-fg">{o.label}</span>
                  {o.sub && <span className="truncate text-[11.5px] text-fg-3">{o.sub}</span>}
                </span>
                <span className="pik-mark">
                  {o.value === value && <Icon name="check" size={12} strokeWidth={2.6} />}
                </span>
              </button>
            ))}
          </div>
          {!shown.length && <div className="px-3 py-3 text-[12.5px] text-fg-3">No match</div>}
        </div>
      )}
    </div>
  );
}
