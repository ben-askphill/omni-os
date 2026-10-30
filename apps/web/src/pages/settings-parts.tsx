import type { ReactNode } from 'react';
import { Label, Toggle } from '../components/ui.tsx';

// The pieces the Settings sections share: a card, a labelled field, a status row and a switch row.

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
