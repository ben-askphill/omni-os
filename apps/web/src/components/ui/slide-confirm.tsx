import { useRef, useState } from 'react';
import { Loader } from '../brand.tsx';
import { Icon } from './icons.tsx';

// ---------- slide to confirm (Bencho "sld") ----------

const GRIP = 48;

export function SlideToConfirm({
  label,
  doneLabel = 'Done',
  busyLabel,
  disabled,
  onConfirm,
  className = '',
}: {
  label: string;
  doneLabel?: string;
  busyLabel?: string;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [held, setHeld] = useState(false);
  const [spring, setSpring] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle');
  const start = useRef(0);

  const max = () => Math.max(0, (track.current?.clientWidth ?? 0) - GRIP - 8);

  const complete = async () => {
    setSpring(true);
    setX(max());
    setPhase('busy');
    try {
      await onConfirm();
      setPhase('done');
    } catch {
      setPhase('idle');
      setX(0);
    }
  };

  const release = () => {
    if (!held) return;
    setHeld(false);
    if (x >= max() * 0.9) void complete();
    else {
      setSpring(true);
      setX(0);
    }
  };

  const locked = disabled || phase !== 'idle';
  const m = max() || 1;
  const progress = Math.min(1, x / m);

  return (
    <div ref={track} className={`sld ${disabled ? 'opacity-45' : ''} ${className}`} data-held={held || undefined} data-done={phase === 'done' || undefined}>
      {phase === 'done' ? (
        <div className="sld-done">
          <Icon name="check" size={16} /> {doneLabel}
        </div>
      ) : (
        <>
          <div className="sld-wash" data-spring={spring || undefined} style={{ width: x + GRIP }} />
          <div className="sld-say" style={{ opacity: phase === 'busy' ? 1 : 1 - progress * 1.4 }}>
            {phase === 'busy' ? (
              <span className="inline-flex items-center gap-2 text-fg-2">
                <Loader size={14} /> {busyLabel ?? 'Working'}
              </span>
            ) : (
              label
            )}
          </div>
          <button
            type="button"
            className="sld-grip"
            aria-label={label}
            disabled={locked}
            data-spring={spring || undefined}
            style={{ transform: `translate3d(${x}px, 0, 0)` }}
            onPointerDown={(e) => {
              if (locked) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              start.current = e.clientX - x;
              setSpring(false);
              setHeld(true);
            }}
            onPointerMove={(e) => held && setX(Math.max(0, Math.min(max(), e.clientX - start.current)))}
            onPointerUp={release}
            onPointerCancel={release}
            onKeyDown={(e) => {
              if (locked) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void complete();
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setSpring(true);
                const nx = Math.min(max(), x + max() / 4);
                setX(nx);
                if (nx >= max()) void complete();
              } else if (e.key === 'ArrowLeft' || e.key === 'Escape') {
                setSpring(true);
                setX(0);
              }
            }}
          >
            {phase === 'busy' ? <Loader size={16} /> : <Icon name="arrowRight" size={18} strokeWidth={2} />}
          </button>
        </>
      )}
    </div>
  );
}
