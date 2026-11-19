import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons.tsx';
import { ROVING_ITEM, useRovingFocus } from './use-roving-focus.ts';

export interface SegOption<T extends string> {
  id: T;
  label?: ReactNode;
  href?: string;
  icon?: IconName;
  badge?: ReactNode;
  title?: string;
}

/**
 * What a Segmented row is, which sets its roles and keys:
 * - `choice` (the default): one of a few options, a filter or a setting. A radio group.
 * - `tabs`: switches the panel under it, which carries tabPanelProps. Tabs.
 * - `nav`: links to pages, the current one marked aria-current. Every link is a Tab stop.
 * `choice` and `tabs` are one Tab stop: the arrow keys, Home and End move and pick (tabs with `manual` only move, and
 * Enter or Space picks).
 */
export type SegKind = 'choice' | 'tabs' | 'nav';

/** The id of the tab for `id` in the row whose panel is `panel`. */
export const tabId = (panel: string, id: string) => `${panel}-tab-${id}`;

/** Spread on the element that shows the selected tab's content: names it by its tab. */
export const tabPanelProps = (panel: string, value: string) => ({ role: 'tabpanel', id: panel, 'aria-labelledby': tabId(panel, value) }) as const;

/** A row of choices, tabs or page links (`kind`). Each item paints its own state (index.css .seg-item). Links when options carry `href`, buttons otherwise. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  label,
  kind = 'choice',
  panel,
  manual,
  className = '',
}: {
  options: SegOption<T>[];
  value: T;
  onChange?: (id: T) => void;
  size?: 'sm' | 'md';
  label?: string;
  kind?: SegKind;
  /** `tabs`: the id of the panel the tabs switch (useId), which spreads tabPanelProps(panel, value). */
  panel?: string;
  /** `tabs`: the arrows only move, Enter or Space picks. For panels that cost something to show, or take the focus. */
  manual?: boolean;
  className?: string;
}) {
  const roving = useRovingFocus<HTMLDivElement>({ stop: 'selected', activate: !(kind === 'tabs' && manual), vertical: kind === 'choice' });
  const items = options.map((o) => {
    const active = o.id === value;
    const common = {
      ...(kind === 'nav' ? {} : ROVING_ITEM),
      id: kind === 'tabs' && panel ? tabId(panel, o.id) : undefined,
      role: kind === 'tabs' ? 'tab' : kind === 'choice' ? 'radio' : undefined,
      'aria-selected': kind === 'tabs' ? active : undefined,
      'aria-checked': kind === 'choice' ? active : undefined,
      'aria-current': kind === 'nav' && active ? 'page' : undefined,
      'aria-label': o.label ? undefined : o.title,
      title: o.title,
      'data-active': active,
      className: 'seg-item item',
    } as const;
    const inner = (
      <>
        {o.icon && <Icon name={o.icon} size={o.label ? (size === 'sm' ? 13 : 14) : 15} />}
        {o.label}
        {o.badge}
      </>
    );
    return o.href ? (
      <a key={o.id} href={o.href} {...common}>
        {inner}
      </a>
    ) : (
      <button key={o.id} type="button" onClick={() => onChange?.(o.id)} {...common}>
        {inner}
      </button>
    );
  });
  if (kind === 'nav') {
    return (
      <nav aria-label={label} data-size={size} className={`seg ${className}`}>
        {items}
      </nav>
    );
  }
  return (
    <div ref={roving.ref} onKeyDown={roving.onKeyDown} onFocus={roving.onFocus} role={kind === 'tabs' ? 'tablist' : 'radiogroup'} aria-label={label} data-size={size} className={`seg ${className}`}>
      {items}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
  size,
  kind,
  panel,
  label,
}: {
  tabs: { id: T; label: ReactNode; href?: string; badge?: ReactNode }[];
  value: T;
  onChange?: (id: T) => void;
  className?: string;
  size?: 'sm' | 'md';
  kind?: SegKind;
  panel?: string;
  label?: string;
}) {
  return (
    <div className={`scroll-thin max-w-full overflow-x-auto ${className}`}>
      <Segmented options={tabs} value={value} onChange={onChange} size={size} kind={kind} panel={panel} label={label} />
    </div>
  );
}
