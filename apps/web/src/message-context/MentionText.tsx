// Machine mentions drawn inline in a sent or queued message (packages/shared/message-context-machine.ts
// `mentionPieces`), the way the composer shows them as chips (components/composer/MessageEditor.tsx). The records are
// untouched: this is how a mention looks, not what the message carries.
import { Fragment, useMemo, useState } from 'react';
import { mentionPieces, type MachineMention, type MentionSpan } from '@omni/shared/message-context-machine.ts';
import { readContexts } from '@omni/shared/message-context-kinds.ts';
import { Icon } from '../components/ui.tsx';
import { ContextInspector } from './ContextChips.tsx';
import { reachLine } from './machine-mention.tsx';

/** A mention in a sent message: the monitor icon and the name. A tap opens what was recorded about the machine. */
function SentPill({ name, span, open, onToggle }: { name: string; span: MentionSpan; open: boolean; onToggle: () => void }) {
  const m: MachineMention = span.mention;
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} title={`${m.name}: ${reachLine(m.reachability, m.last_seen)} when sent`} className="mention-pill mention-pill-sent">
      <Icon name="monitor" size={12} strokeWidth={2} className="mention-icon" />
      {name}
    </button>
  );
}

/** A sent or queued message's text with its machine mentions as pills, where their chips used to sit over the bubble. */
export function MentionText({ text, records }: { text: string; records: unknown }) {
  const [open, setOpen] = useState<string | null>(null);
  const pieces = useMemo(() => mentionPieces(text, records), [text, records]);
  const shown = open ? readContexts(records).find((r) => r.record.id === open) : undefined;
  return (
    <>
      {pieces.map((p, i) =>
        p.span ? (
          <SentPill key={i} name={p.text.slice(1)} span={p.span} open={open === p.span.id} onToggle={() => setOpen((o) => (o === p.span!.id ? null : p.span!.id))} />
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
      {shown && (
        <div className="whitespace-normal">
          <ContextInspector reading={shown} />
        </div>
      )}
    </>
  );
}
