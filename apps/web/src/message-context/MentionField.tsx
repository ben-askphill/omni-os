// Machine mentions drawn inline (packages/shared/message-context-machine.ts `mentionSpans`): in every composer, a layer
// behind the textarea draws its text with each mentioned `@<name>` as a pill, and in a sent message the bubble does the
// same. The textarea keeps the plain text, the caret and every key; only its glyphs go transparent so the layer shows
// through. The records are untouched: this is how a mention looks, not what the message carries.
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type CSSProperties, type RefObject, type SyntheticEvent } from 'react';
import { deleteMention, mentionPieces, mentionSpans, snapOutOfMention, type MachineMention, type MentionSpan } from '@omni/shared/message-context-machine.ts';
import { readContexts } from '@omni/shared/message-context-kinds.ts';
import { Icon } from '../components/ui.tsx';
import { ContextInspector } from './ContextChips.tsx';
import { reachLine } from './machine-mention.tsx';

// What decides where a glyph lands: the layer copies them from the textarea, so the two lay out the same text alike.
const MIRRORED = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-feature-settings',
  'font-variation-settings',
  'font-kerning',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-transform',
  'text-indent',
  'text-align',
  'tab-size',
  'direction',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
] as const;

/** The pill's `@`: the glyph keeps its width, transparent, and the monitor icon sits over it. */
function At() {
  return (
    <span className="mention-at">
      @
      <Icon name="monitor" size={12} strokeWidth={2} className="mention-at-icon" />
    </span>
  );
}

/**
 * A composer's text with its machine mentions as pills. `records` is the draft's context. Spread `textarea` on the
 * textarea after the composer's own handlers are wired through it: `onKeyDown` first (true when it used the key),
 * then `onSelect` and `onScroll`, and `style`. Render `layer` just before the textarea, in the same parent.
 */
export function useMentionField(ref: RefObject<HTMLTextAreaElement | null>, text: string, records: unknown) {
  const spans = useMemo(() => mentionSpans(text, records), [text, records]);
  const on = spans.length > 0;
  const layer = useRef<HTMLDivElement>(null);
  const prev = useRef(0);
  const [caret, setCaret] = useState<{ at: number } | null>(null);

  const sync = () => {
    const ta = ref.current;
    const el = layer.current;
    if (!ta || !el) return;
    const cs = getComputedStyle(ta);
    for (const p of MIRRORED) el.style.setProperty(p, cs.getPropertyValue(p));
    el.style.top = `${ta.offsetTop + ta.clientTop}px`;
    el.style.left = `${ta.offsetLeft + ta.clientLeft}px`;
    el.style.width = `${ta.clientWidth}px`;
    el.style.height = `${ta.clientHeight}px`;
    el.scrollTop = ta.scrollTop;
  };

  useLayoutEffect(sync);
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!on || !ta || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => sync());
    ro.observe(ta);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, ref]);
  useLayoutEffect(() => {
    if (caret) ref.current?.setSelectionRange(caret.at, caret.at);
  }, [caret, ref]);

  /** Backspace or Delete on a pill takes all of it. True when the key was used. */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>, onText: (text: string) => void) => {
    if (!on || (e.key !== 'Backspace' && e.key !== 'Delete') || e.nativeEvent.isComposing) return false;
    const ta = e.currentTarget;
    const cut = deleteMention(ta.value, ta.selectionStart, ta.selectionEnd, e.key, spans);
    if (!cut) return false;
    e.preventDefault();
    const gone = ta.value.length - cut.text.length;
    const start = cut.caret;
    // Through the editor, so Undo brings the pill back and the composer's onChange sees an ordinary edit.
    ta.setSelectionRange(start, start + gone);
    let done = false;
    try {
      done = document.execCommand('delete');
    } catch {
      done = false;
    }
    if (!done || ta.value !== cut.text) onText(cut.text);
    prev.current = start;
    setCaret({ at: start });
    return true;
  };

  const onSelect = (e: SyntheticEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const at = ta.selectionStart;
    if (on && at === ta.selectionEnd) {
      const out = snapOutOfMention(at, prev.current, spans);
      if (out !== null) {
        ta.setSelectionRange(out, out);
        prev.current = out;
        return;
      }
    }
    prev.current = at;
  };

  const style: CSSProperties | undefined = on ? { color: 'transparent', caretColor: 'var(--fg)', position: 'relative' } : undefined;

  const view = on ? (
    <div ref={layer} aria-hidden className="mention-layer text-fg">
      {mentionPieces(text, records).map((p, i) =>
        p.span ? (
          <span key={i} className="mention-pill">
            <At />
            {p.text.slice(1)}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
      {/* A trailing newline only gets its line in the layer when something follows it. */}{' '}
    </div>
  ) : null;

  return { on, spans, layer: view, onKeyDown, onSelect, onScroll: sync, style };
}

/** A mention in a sent message: the monitor icon and the name. A tap opens what was recorded about the machine. */
function SentPill({ name, span, open, onToggle }: { name: string; span: MentionSpan; open: boolean; onToggle: () => void }) {
  const m: MachineMention = span.mention;
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} title={`${m.name}: ${reachLine(m.reachability, m.last_seen)} when sent`} className="mention-pill mention-pill-sent">
      <Icon name="monitor" size={12} strokeWidth={2} className="mention-sent-icon" />
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
