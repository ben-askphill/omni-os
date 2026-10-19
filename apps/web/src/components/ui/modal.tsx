import { useEffect, useRef, type ReactNode } from 'react';
import { ErrorNote } from './feedback.tsx';
import { Button, IconButton } from './primitives.tsx';
import { useDismissable } from './use-dismissable.ts';

// ---------- modal / confirm ----------

export function Modal({ open, onClose, children, title, wide }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismissable(open, onClose, { outside: false });
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus], button, input, select, textarea')?.focus();
    return () => {
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="scrim fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={`modal-in max-h-[92vh] w-full overflow-auto rounded-t-[28px] bg-elev pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-menu)] sm:rounded-[28px] sm:pb-0 ${wide ? 'sm:max-w-5xl' : 'sm:max-w-md'}`}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 py-3 pr-3 pl-6">
            <div className="min-w-0 font-display text-[16px]">{title}</div>
            <IconButton icon="x" label="Close" onClick={onClose} />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={busy ? () => {} : onCancel} title={title}>
      <div className="space-y-3 px-6 pt-1 pb-4 text-[13.5px] text-fg-2">{children}</div>
      {error && <ErrorNote className="mx-6 mb-3">{error}</ErrorNote>}
      <div className="flex justify-end gap-2 px-5 pt-1 pb-5">
        {/* Focus starts on Cancel: every confirm here is destructive, so a stray Enter must not fire it. */}
        <Button variant="secondary" onClick={onCancel} disabled={busy} data-autofocus>
          Cancel
        </Button>
        <Button variant={danger ? 'needs' : 'primary'} onClick={onConfirm} busy={busy}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
