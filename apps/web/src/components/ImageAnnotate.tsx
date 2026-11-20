// Annotating an image from the thread's Files panel and sending it back as a change request: Ben draws on the file
// (pen, shapes, arrows, text notes), writes what should change, and Send posts a new message to the thread with the
// marks flattened into a PNG attachment and the notes in words (packages/shared/image-annotation.ts). A file a delegated
// thread made goes to that thread unless he picks this one; a cold one says so and asks before it wakes it.
import { useMemo, useRef, useState } from 'react';
import { NOTE_MAX } from '@omni/shared/message-context.ts';
import { MARK_TEXT_MAX, textSize, textToMark, type MarkStyle } from '@omni/shared/message-context-marks.ts';
import { annotatedName, annotationCanvas, annotationPrompt, annotationTarget } from '@omni/shared/image-annotation.ts';
import { artifactUrl, errorText, useApi, type Artifact } from '../api.ts';
import { useFit } from './BrowserAnnotate.tsx';
import { MarkToolbar } from './BrowserMarkToolbar.tsx';
import { renderMarked } from './browser-marks-canvas.ts';
import { useReplySend } from './Composer.tsx';
import { useMarkEditor } from './useMarkEditor.ts';
import { Button, ErrorNote, Icon, Picker, type PickerOption } from './ui.tsx';
import { useDismissLayer } from './ui/dismiss-stack.ts';
import { isImeEnter } from '../ime.ts';

interface Warmth {
  session?: { warm: boolean; idle_minutes: number | null };
}

/** Where a sent annotation went, for the line that links to it. */
export interface AnnotationSent {
  thread: string;
  label: string;
}

/**
 * Over the file viewer. `threadId` is the thread whose panel shows the file; `from` names the delegated thread that
 * made it, when one did. `natural` is the image's own size, known once the preview has loaded it.
 */
export function ImageAnnotateLayer({
  a,
  threadId,
  from,
  natural,
  onClose,
  onSent,
}: {
  a: Artifact;
  threadId: string;
  from?: { id: string; title: string };
  natural: { w: number; h: number };
  onClose: () => void;
  onSent: (sent: AnnotationSent) => void;
}) {
  const canvas = useMemo(() => annotationCanvas({ width: natural.w, height: natural.h }), [natural.w, natural.h]);
  const { box, scale, shown } = useFit(canvas);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [target, setTarget] = useState(() => annotationTarget(a, threadId));
  const send = useReplySend(target);
  const elsewhere = target !== threadId;
  // A parent follows up on a warm thread and asks before waking a cold one (session-warmth.ts).
  const warmth = useApi<Warmth>(elsewhere ? `/threads/${encodeURIComponent(target)}/summary` : null);
  const cold = elsewhere && warmth.data?.session?.warm === false ? warmth.data.session : null;
  const targetLabel = elsewhere ? from?.title || 'the delegated thread' : 'this thread';

  const editor = useMarkEditor({
    viewport: canvas,
    shown,
    scale,
    adding: sending,
    setError,
    focusNote: () => {},
    onArea: () => {},
    onTap: () => {},
    initialTool: 'rect',
  });
  const { stage, overlay, tool, shape, setShape, color, stroke, marks, selected, setGesture, typing, setTyping, pickTool, recolor, restroke, undo, clear, remove, commitText, down, move, up } = editor;

  const layerRoot = useRef<HTMLDivElement>(null);
  useDismissLayer(true, {
    roots: () => [layerRoot.current],
    escape: (e) => {
      if ((e.target as HTMLElement | null)?.hasAttribute?.('data-mark-text')) return false;
      onClose();
    },
  });

  const options = useMemo<PickerOption<string>[]>(
    () => (from ? [{ value: from.id, label: from.title || 'Untitled', sub: 'The thread that made this file', icon: 'delegate', avatar: false }, { value: threadId, label: 'This thread', icon: 'message', avatar: false }] : []),
    [from, threadId],
  );

  const submit = async () => {
    if (sending) return;
    // A note still being typed counts: commitText's mark lands with the next render, so it is made here too.
    const typed = typing?.text.trim() ? textToMark(typing.text, typing, shown, canvas, { color: color as MarkStyle['color'], stroke }) : null;
    const pending = typed?.ok ? [...marks, typed.value] : marks;
    commitText();
    if (!pending.length && !message.trim()) return setError('Mark the image or write what should change.');
    setSending(true);
    setError(null);
    try {
      const blob = await renderMarked(artifactUrl(a), pending, canvas.width);
      const name = annotatedName(a.name, blob.type);
      const file = new File([blob], name, { type: blob.type || 'image/png' });
      const prompt = annotationPrompt({ message, source: a.name, from: elsewhere ? null : from?.title, marks: pending, k: canvas.k });
      await send(prompt, undefined, [file]);
      onSent({ thread: target, label: targetLabel });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  };

  const ready = marks.length > 0 || !!message.trim() || !!typing?.text.trim();
  return (
    <div ref={layerRoot} role="dialog" aria-label="Annotate the image" className="absolute inset-0 z-20 flex min-h-0 flex-col bg-bg">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2 text-[12px]">
        <Icon name="annotate" size={13} className="shrink-0 text-fg-3" />
        <span className="min-w-0 flex-1 truncate text-fg-2">Mark up {a.name}</span>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <MarkToolbar
        tool={tool}
        shape={shape}
        color={color}
        stroke={stroke}
        canUndo={marks.length > 0}
        canDelete={selected >= 0}
        onTool={pickTool}
        onShape={setShape}
        onColor={recolor}
        onStroke={restroke}
        onUndo={undo}
        onDelete={() => remove(selected)}
        onClear={clear}
      />
      <div className="flex min-h-0 flex-1 px-3">
        {/* Measured inside the padding, so the fitted image keeps its gutter. */}
        <div ref={box} className="relative flex min-h-0 min-w-0 flex-1 items-start justify-center overflow-hidden">
          <div
            ref={stage}
            aria-label="The image. Pick a tool, then draw on it."
            role="img"
            className={`relative shrink-0 touch-none overflow-hidden rounded-lg shadow-[inset_0_0_0_1px_var(--line)] select-none ${tool === 'text' ? 'cursor-text' : 'cursor-crosshair'}`}
            style={{ width: shown.width || undefined, height: shown.height || undefined }}
            onPointerDown={down}
            onMouseDown={(e) => tool === 'text' && e.preventDefault()}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => setGesture(null)}
          >
            <img src={artifactUrl(a)} alt="" draggable={false} className="pointer-events-none absolute inset-0 block h-full w-full" />
            <canvas ref={overlay} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
            {typing && (
              <input
                autoFocus
                data-mark-text
                value={typing.text}
                maxLength={MARK_TEXT_MAX}
                aria-label="Note on the image"
                onChange={(e) => setTyping({ ...typing, text: e.target.value })}
                onPointerDown={(e) => e.stopPropagation()}
                onBlur={commitText}
                onKeyDown={(e) => {
                  if (isImeEnter(e)) return;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitText();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setTyping(null);
                  }
                }}
                className="absolute m-0 border-0 bg-transparent p-0 font-semibold outline-none"
                style={{
                  left: typing.x,
                  top: typing.y,
                  width: Math.max(80, shown.width - typing.x),
                  color,
                  fontSize: textSize(stroke) * scale,
                  lineHeight: 1.25,
                  caretColor: color,
                  borderBottom: `1px dashed ${color}`,
                }}
              />
            )}
          </div>
        </div>
      </div>
      <div className="shrink-0 px-3 pt-2 pb-3">
        <textarea
          value={message}
          maxLength={NOTE_MAX}
          rows={2}
          aria-label="Message for the agent"
          placeholder="What should change? (optional)"
          onChange={(e) => {
            setMessage(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (isImeEnter(e)) return;
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          className="block w-full resize-none rounded-xl bg-surface px-3 py-2 text-[16px] leading-[1.45] outline-none placeholder:text-fg-4 focus:shadow-[inset_0_0_0_1px_var(--line-strong)] sm:text-[13px]"
        />
        {cold && (
          <p className="mt-2 text-[11.5px] leading-snug text-fg-3" data-cold>
            {`${targetLabel} has been idle ${cold.idle_minutes ?? 'many'} minutes, so its session is out of the prompt cache. Sending wakes it and it re-reads its whole context uncached. `}
            <button type="button" className="font-medium text-fg underline-offset-2 hover:underline" onClick={() => setTarget(threadId)}>
              Send to this thread instead
            </button>
          </p>
        )}
        {error && <ErrorNote className="mt-2">{error}</ErrorNote>}
        <div className="mt-2 flex min-w-0 items-center justify-end gap-2 text-[11.5px] text-fg-3">
          {options.length > 0 ? (
            <>
              <span className="shrink-0">Send to</span>
              <Picker label="Send the annotation to" value={target} options={options} onChange={setTarget} align="right" className="min-w-0" />
            </>
          ) : (
            <span className="min-w-0 truncate">Sends to this thread</span>
          )}
          <Button size="sm" variant="primary" icon="send" disabled={!ready} busy={sending} onClick={() => void submit()}>
            {cold ? 'Wake and send' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  );
}
