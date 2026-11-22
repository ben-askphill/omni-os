import { useMemo, useState, type ReactNode } from 'react';
import { Accordion, AccordionHeader, AccordionItem, AccordionPanel, AccordionTrigger } from '@ui-sdk/react/accordion';
import { reportShape } from '@omni/shared/report-shape.ts';
import type { ReportP } from '@omni/shared/transcript-fold.ts';
import { useFindOpens } from '../../transcript/find-target.ts';
import { Icon } from '../ui.tsx';
import { Markdown } from '../Markdown.tsx';

const NOTES = 'progress-notes';

/**
 * A crew report's body, on desktop and the phone layout: the outcome first, its pull requests as chips, then each part
 * the agent wrote under a heading folded, and what it said while it worked folded last (report-shape.ts). `event`: the
 * report's row, so the find bar opens every section when its match is in this report. `phone`: the phone's prose size.
 */
export function ReportBody({ r, event, phone = false }: { r: ReportP; event?: number; phone?: boolean }) {
  const shape = useMemo(() => reportShape(r.text || '(no reply)', r.notes), [r.text, r.notes]);
  const keys = [...shape.sections.map((s) => s.key), ...(shape.notes.length ? [NOTES] : [])];
  const [open, setOpen] = useState<string[]>(() => (shape.lead || !shape.sections.length ? [] : [shape.sections[0].key]));
  useFindOpens(
    (t) => t === event,
    () => setOpen(keys),
  );
  const prose = phone ? 'text-[15px] leading-[1.6] text-pretty' : '';
  return (
    <div className="flex flex-col gap-3">
      {shape.lead && <Markdown text={shape.lead} className={prose} />}
      {shape.prs.length > 0 && (
        <div data-find-skip className="flex flex-wrap gap-1.5">
          {shape.prs.map((pr) => (
            <a
              key={pr.href}
              href={pr.href}
              target="_blank"
              rel="noopener noreferrer"
              className="press focus-ring inline-flex h-8 items-center gap-1.5 rounded-full bg-bg px-3 text-[12.5px] font-medium text-fg shadow-[var(--shadow-card)]"
            >
              <Icon name="pr" size={13} className="text-fg-3" />
              {pr.label}
              <Icon name="arrowUpRight" size={12} className="text-fg-3" />
            </a>
          ))}
        </div>
      )}
      {keys.length > 0 && (
        <Accordion multiple hiddenUntilFound value={open} onValueChange={(v) => setOpen(v as string[])} className="overflow-hidden rounded-[16px] border border-line">
          {shape.sections.map((s) => (
            <Section key={s.key} value={s.key} title={s.title} count={s.count}>
              <Markdown text={s.body} className={phone ? 'text-[14.5px] leading-[1.55]' : 'text-[13.5px]'} />
            </Section>
          ))}
          {shape.notes.length > 0 && (
            <Section value={NOTES} title="Progress notes" count={shape.notes.length}>
              <ol className="flex flex-col gap-2 border-l border-line pl-3">
                {shape.notes.map((n, i) => (
                  <li key={i}>
                    <Markdown text={n} className="text-[13px] leading-[1.5] text-fg-2" />
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </Accordion>
      )}
    </div>
  );
}

function Section({ value, title, count, children }: { value: string; title: string; count: number | null; children: ReactNode }) {
  return (
    <AccordionItem value={value} className="border-line not-first:border-t">
      <AccordionHeader render={<h4 className="m-0" />}>
        <AccordionTrigger className="group press focus-ring flex min-h-11 w-full items-center gap-2 px-3.5 py-2 text-left text-[13.5px] font-medium text-fg">
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {count !== null && <span className="rounded-full bg-surface-3 px-2 py-1 text-[11.5px] leading-none font-medium text-fg-2 tabular-nums">{count}</span>}
          <Icon name="chevronDown" size={14} className="shrink-0 text-fg-3 group-data-open:rotate-180" />
        </AccordionTrigger>
      </AccordionHeader>
      {/* The padding sits inside: a closed hidden="until-found" panel keeps its own box. */}
      <AccordionPanel>
        <div className="px-3.5 pb-3.5">{children}</div>
      </AccordionPanel>
    </AccordionItem>
  );
}
