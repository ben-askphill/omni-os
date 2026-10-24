// A message's context as chips: in both composers, where each can be removed, and over sent and queued messages.
// Names no kind. A kind's icon and what its chip opens to come from CONTEXT_VIEWS; a record this build cannot read
// (a newer Omni's kind or version, or a broken one) shows its stored label and says why it can't show more.
import { useId, useMemo, useState } from 'react';
import type { MessageContext, MessageContextKind } from '@omni/shared/message-context.ts';
import { CONTEXT_KINDS, readContexts, type BodyOf, type ContextReading, type KindName } from '@omni/shared/message-context-kinds.ts';
import { Icon, IconButton } from '../components/ui.tsx';
import { CONTEXT_VIEWS } from './kinds.ts';

const KINDS: { [K in KindName]: MessageContextKind<BodyOf<K>> } = CONTEXT_KINDS;

export const NEWER_LABEL = 'Context from a newer Omni';

export const hasContext = (raw: unknown) => Array.isArray(raw) && raw.length > 0;

const knownLabel = <K extends KindName>(kind: K, body: BodyOf<K>) => KINDS[kind].label(body);

/** The chip's line: the stored label, else the kind's own for a record this build reads. */
export const chipLabel = (r: ContextReading) => r.record.label || (r.as === 'known' ? knownLabel(r.kind, r.body) : NEWER_LABEL);

export const cantShowText = (r: Pick<MessageContext, 'kind' | 'v'>) =>
  `This Omni can't show ${r.kind ? `${r.kind} v${r.v}` : 'this item'}. Update Omni to see it.`;

function KnownDetail<K extends KindName>({ kind, body, record }: { kind: K; body: BodyOf<K>; record: MessageContext }) {
  const { Detail } = CONTEXT_VIEWS[kind];
  return <Detail body={body} record={record} />;
}

/** What a chip opens to: the kind's own view and Ben's note, or for a fallback its label, the note and why. */
export function ContextInspector({ reading: r, id }: { reading: ContextReading; id?: string }) {
  return (
    <div id={id} role="region" aria-label={chipLabel(r)} className="mt-1.5 w-full min-w-0 rounded-2xl bg-surface p-3 text-left text-[12.5px] shadow-[inset_0_0_0_1px_var(--line)]">
      {r.as === 'known' ? (
        <KnownDetail kind={r.kind} body={r.body} record={r.record} />
      ) : (
        <>
          <div className="truncate font-mono text-[12px] text-fg">{r.record.label || NEWER_LABEL}</div>
          <p className="mt-1.5 flex items-start gap-1.5 leading-snug text-fg-3">
            <Icon name="info" size={13} className="mt-px shrink-0" />
            {cantShowText(r.record)}
          </p>
        </>
      )}
      {r.record.note && <p className="mt-2.5 border-l-2 border-line-strong pl-2.5 leading-[1.5] break-words whitespace-pre-wrap text-fg-2">{r.record.note}</p>}
    </div>
  );
}

function ContextChip({ r, open, controls, onToggle, onRemove }: { r: ContextReading; open: boolean; controls: string; onToggle: () => void; onRemove?: () => void }) {
  const label = chipLabel(r);
  const note = r.record.note.trim().split('\n')[0];
  return (
    <span className={`flex h-11 max-w-[16rem] min-w-0 items-center rounded-2xl bg-surface-2 text-[12.5px] ${open ? 'shadow-[inset_0_0_0_1px_var(--line-strong)]' : ''}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={open ? controls : undefined}
        title={label}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-2xl pr-2 pl-1 text-left"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-bg text-fg-3">
          <Icon name={r.as === 'known' ? CONTEXT_VIEWS[r.kind].icon : 'info'} size={15} />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate font-mono text-[12px] font-medium text-fg-2">{label}</span>
          {note && <span className="block truncate text-[11px] text-fg-4">{note}</span>}
        </span>
      </button>
      {onRemove && <IconButton icon="x" label={`Remove ${label}`} size={13} className="mr-1 h-6 w-6" onClick={onRemove} />}
    </span>
  );
}

/**
 * `records` as stored or drafted, read leniently: anything that is not a list shows nothing. A chip opens its
 * inspector under the strip. `onRemove` makes the chips removable.
 */
export function ContextChips({
  records,
  onRemove,
  align = 'start',
  className = '',
}: {
  records: unknown;
  onRemove?: (id: string) => void;
  align?: 'start' | 'end';
  className?: string;
}) {
  const readings = useMemo(() => readContexts(records), [records]);
  const [open, setOpen] = useState<string | null>(null);
  const inspector = useId();
  if (!readings.length) return null;
  const shown = readings.find((r) => r.record.id === open);
  return (
    <div className={`flex flex-col ${align === 'end' ? 'items-end' : 'items-start'} ${className}`}>
      <div className={`flex max-w-full flex-wrap gap-1.5 ${align === 'end' ? 'justify-end' : ''}`}>
        {readings.map((r, i) => (
          <ContextChip
            key={`${r.record.id}:${i}`}
            r={r}
            open={r === shown}
            controls={inspector}
            onToggle={() => setOpen((o) => (o === r.record.id ? null : r.record.id))}
            onRemove={onRemove && (() => onRemove(r.record.id))}
          />
        ))}
      </div>
      {shown && <ContextInspector id={inspector} reading={shown} />}
    </div>
  );
}
