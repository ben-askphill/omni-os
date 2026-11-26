import type { ReactNode } from 'react';

/**
 * The card a list-panel row shows on hover and keyboard focus (useTooltip, `variant: 'card'`): a small head line (the
 * channel and the time or status), the full title, then lines of detail. It holds no buttons: row actions stay on the
 * row, so nothing in the card needs focus.
 */
export function RowCard({ head, title, lines = [] }: { head?: ReactNode; title: ReactNode; lines?: ReactNode[] }) {
  return (
    <span className="block space-y-1 text-left">
      {head && <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-fg-3">{head}</span>}
      <span className="block text-[12.5px] leading-[1.35] font-medium break-words text-fg">{title}</span>
      {lines.map((line, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5 text-[11.5px] leading-[1.35] text-fg-3">
          {line}
        </span>
      ))}
    </span>
  );
}
