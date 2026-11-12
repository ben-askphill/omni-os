import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons.tsx';

export interface SegOption<T extends string> {
  id: T;
  label?: ReactNode;
  href?: string;
  icon?: IconName;
  badge?: ReactNode;
  title?: string;
}

/** A row of tabs, or radios with `radio`. Each item paints its own state (index.css .seg-item). Links when options carry `href`, buttons otherwise. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  label,
  radio,
  className = '',
}: {
  options: SegOption<T>[];
  value: T;
  onChange?: (id: T) => void;
  size?: 'sm' | 'md';
  label?: string;
  /** Radio semantics for settings; tab semantics otherwise. */
  radio?: boolean;
  className?: string;
}) {
  return (
    <div role={radio ? 'radiogroup' : 'tablist'} aria-label={label} data-size={size} className={`seg ${className}`}>
      {options.map((o) => {
        const active = o.id === value;
        const common = {
          role: radio ? 'radio' : 'tab',
          'aria-selected': radio ? undefined : active,
          'aria-checked': radio ? active : undefined,
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
      })}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
  size,
}: {
  tabs: { id: T; label: ReactNode; href?: string; badge?: ReactNode }[];
  value: T;
  onChange?: (id: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`scroll-thin max-w-full overflow-x-auto ${className}`}>
      <Segmented options={tabs} value={value} onChange={onChange} size={size} />
    </div>
  );
}
