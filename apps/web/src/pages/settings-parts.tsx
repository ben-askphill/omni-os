import { useEffect, useState, type ReactNode } from 'react';
import { Icon, Label, Toggle } from '../components/ui.tsx';

// The pieces the Settings sections and channel settings share: a card, a labelled field, a status row, a switch
// row and the Advanced fold.

/**
 * Advanced: the developer and rarely changed items of a form, folded shut so the everyday ones stand alone (#405).
 * `open` forces it open, for a value Omni could not work out and needs typed. `title` names a fold that is not
 * Advanced (a long list). The Mac app's `AdvancedFold` matches.
 */
export function Advanced({ title = 'Advanced', summary, open: forced = false, children }: { title?: string; summary?: string; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(forced);
  useEffect(() => {
    if (forced) setOpen(true);
  }, [forced]);
  return (
    <section className="rounded-[20px] shadow-[inset_0_0_0_1px_var(--line)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-2 rounded-[20px] px-4 py-3 text-left hover:bg-surface md:px-5"
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} className="shrink-0 text-fg-3" />
        <span className="shrink-0 font-display text-[15px]">{title}</span>
        {summary && !open && <span className="min-w-0 truncate text-[12.5px] text-fg-3">{summary}</span>}
      </button>
      {open && <div className="space-y-4 px-4 pt-1 pb-4 md:px-5 md:pb-5">{children}</div>}
    </section>
  );
}

export function Card({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-[20px] bg-surface p-4 md:p-5">
      <div>
        <div className="font-display text-[15px]">{title}</div>
        {subtitle && <p className="mt-0.5 text-[12.5px] text-fg-3">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={htmlFor} hint={hint}>
        {label}
      </Label>
      {children}
    </div>
  );
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-20 shrink-0 text-fg-3">{label}</span>
      {children}
    </div>
  );
}

export function SwitchRow({ title, detail, checked, onChange, disabled }: { title: string; detail: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium">{title}</div>
        <p className="mt-0.5 text-[12.5px] text-fg-3">{detail}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

/** A heading between the parts of a section that gathers what were pages of their own (Sync and Storage under Machines). */
export function PartHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="pt-3">
      <h2 className="font-display text-[20px] leading-tight">{title}</h2>
      <p className="mt-1 text-[12.5px] text-fg-3">{subtitle}</p>
    </div>
  );
}
