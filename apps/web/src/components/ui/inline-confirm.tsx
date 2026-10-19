import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Loader } from '../brand.tsx';
import { Icon, type IconName } from './icons.tsx';
import { useDismissable } from './use-dismissable.ts';

// ---------- inline confirm with undo (Bencho "say") ----------

type SayPhase = 'idle' | 'asking' | 'busy' | 'pending' | 'done';

/**
 * A pill that asks in place. With `undoMs`, confirming shows an Undo button with a burning fuse and
 * `onConfirm` only runs once the fuse is out (or the component unmounts). Without it, `onConfirm`
 * runs right away. Errors are the caller's to surface; the pill resets to idle.
 */
export function InlineConfirm({
  label,
  icon,
  confirmLabel,
  cancelLabel = 'Cancel',
  doneLabel,
  busyLabel,
  undoMs,
  needs = true,
  disabled,
  onConfirm,
  className = '',
}: {
  label: ReactNode;
  icon?: IconName;
  confirmLabel: string;
  cancelLabel?: string;
  doneLabel?: string;
  busyLabel?: string;
  undoMs?: number;
  needs?: boolean;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
  className?: string;
}) {
  const [phase, setPhase] = useState<SayPhase>('idle');
  const [width, setWidth] = useState<number | undefined>(undefined);
  const shell = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const run = useRef(onConfirm);
  run.current = onConfirm;
  const pending = useRef(false);

  const fire = useCallback(async () => {
    pending.current = false;
    setPhase('busy');
    try {
      await run.current();
      setPhase(doneLabel ? 'done' : 'idle');
    } catch {
      setPhase('idle');
    }
  }, [doneLabel]);

  // Measure the visible row so the shell can spring between widths.
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const set = () => setWidth(el.scrollWidth);
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase]);

  useEffect(() => {
    if (phase === 'asking') cancelRef.current?.focus();
  }, [phase]);

  useDismissable(phase === 'asking', () => setPhase('idle'), { root: shell });

  useEffect(() => {
    if (phase !== 'pending' || !undoMs) return;
    pending.current = true;
    const t = setTimeout(() => void fire(), undoMs);
    return () => clearTimeout(t);
  }, [phase, undoMs, fire]);

  // Leaving the page mid-fuse still commits, the way mail clients handle "undo send".
  useEffect(
    () => () => {
      if (pending.current) void run.current();
    },
    [],
  );

  useEffect(() => {
    if (phase !== 'done') return;
    const t = setTimeout(() => setPhase('idle'), 2400);
    return () => clearTimeout(t);
  }, [phase]);

  const confirm = () => (undoMs ? setPhase('pending') : void fire());

  let content: ReactNode;
  if (phase === 'asking') {
    content = (
      <>
        <button ref={cancelRef} type="button" className="say-btn" onClick={() => setPhase('idle')}>
          {cancelLabel}
        </button>
        <span className="say-seam" />
        <button type="button" className="say-btn" data-needs={needs || undefined} onClick={confirm}>
          {confirmLabel}
        </button>
      </>
    );
  } else if (phase === 'busy') {
    content = (
      <span className="say-done">
        <Loader size={13} /> {busyLabel ?? `${confirmLabel}…`}
      </span>
    );
  } else if (phase === 'pending' || phase === 'done') {
    content = (
      <>
        <span className="say-done">
          <Icon name="check" size={14} /> {doneLabel ?? 'Done'}
        </span>
        {phase === 'pending' && (
          <button
            type="button"
            className="say-undo"
            onClick={() => {
              pending.current = false;
              setPhase('idle');
            }}
          >
            <Icon name="undo" size={13} /> Undo
            <span className="say-fuse" style={{ animationDuration: `${undoMs}ms` }} />
          </button>
        )}
      </>
    );
  } else {
    content = (
      <button type="button" className="say-btn" disabled={disabled} onClick={() => setPhase('asking')}>
        {icon && <Icon name={icon} size={14} />}
        {label}
      </button>
    );
  }

  return (
    <div ref={shell} className={`say ${disabled ? 'opacity-45' : ''} ${className}`} style={{ width }} aria-live="polite">
      <div ref={row} className="say-row">
        {content}
      </div>
    </div>
  );
}
