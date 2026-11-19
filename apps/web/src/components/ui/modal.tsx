import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ErrorNote } from './feedback.tsx';
import { KbdHintText } from './overlay.tsx';
import { Button, IconButton } from './primitives.tsx';
import { useModalDialog } from './use-modal-dialog.ts';
import { useExit } from './use-exit.ts';

// ---------- modal / confirm ----------

/** A modal's actions along its bottom edge, the main one last, with the key that runs it on the left. */
export function ModalFooter({ hint, children, className = '' }: { hint?: { keys: readonly string[]; label: string }; children: ReactNode; className?: string }) {
  return (
    <div className={`sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-elev px-6 py-4 ${className}`}>
      {hint && (
        <span className="mr-auto">
          <KbdHintText keys={hint.keys}>{hint.label}</KbdHintText>
        </span>
      )}
      {children}
    </div>
  );
}

const UnsavedCtx = createContext<((dirty: boolean) => void) | null>(null);

/**
 * Tell the enclosing `<Modal dismiss="confirm">` whether its form holds edits that a close would throw away. While it
 * does, Escape, a press on the backdrop and the Close button ask first. Saving still closes through `onClose`.
 */
export function useUnsavedChanges(dirty: boolean) {
  const report = useContext(UnsavedCtx);
  useEffect(() => {
    report?.(dirty);
    return () => report?.(false);
  }, [report, dirty]);
}

type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  wide?: boolean;
  roomy?: boolean;
  /**
   * `any` (the default): Escape, the backdrop and Close all close it. `confirm`, for a form: those ask first while
   * its body reports edits with `useUnsavedChanges`.
   */
  dismiss?: 'any' | 'confirm';
};

/** `wide` for a page-sized view (a diff, a viewer), `roomy` for a form with long text (a crew role's charter). */
export function Modal(props: ModalProps) {
  // Mounted while open and while its exit plays, so the dialog's showModal() and close() follow the component's life.
  // The exit shows what it last showed: an owner often clears what the body reads as it closes.
  const ref = useRef<HTMLDialogElement>(null);
  const kept = useRef(props.children);
  if (props.open) kept.current = props.children;
  const exit = useExit(props.open, ref);
  if (!exit.shown) return null;
  return (
    <ModalDialog {...props} dialogRef={ref} closing={exit.closing}>
      {props.open ? props.children : kept.current}
    </ModalDialog>
  );
}

function ModalDialog({ onClose, children, title, wide, roomy, dismiss = 'any', dialogRef: ref, closing }: ModalProps & { dialogRef: RefObject<HTMLDialogElement | null>; closing: boolean }) {
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dirty = useRef(false);
  const [asking, setAsking] = useState(false);
  const report = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);
  const request = useCallback(() => {
    if (dismiss === 'confirm' && dirty.current) setAsking(true);
    else onCloseRef.current();
  }, [dismiss]);
  // Closing, it hears nothing: the layer under it has the keys and presses.
  const { ready, dialogProps } = useModalDialog(ref, closing ? undefined : request, !closing);
  return (
    <dialog
      ref={ref}
      aria-labelledby={title ? titleId : undefined}
      {...dialogProps}
      data-closing={closing || undefined}
      className={`modal modal-in w-full sm:w-[calc(100%-48px)] ${wide ? 'sm:max-w-5xl' : roomy ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
    >
      {ready && (
        <UnsavedCtx.Provider value={report}>
          {title && (
            <div className="flex items-center justify-between gap-3 py-3 pr-3 pl-6">
              <div id={titleId} className="min-w-0 font-display text-[length:var(--fs-heading)]">
                {title}
              </div>
              <IconButton icon="x" label="Close" onClick={request} />
            </div>
          )}
          {children}
          {dismiss === 'confirm' && (
            <ConfirmDialog
              open={asking}
              title="Discard your changes?"
              confirmLabel="Discard"
              cancelLabel="Keep editing"
              danger
              onConfirm={() => {
                setAsking(false);
                onCloseRef.current();
              }}
              onCancel={() => setAsking(false)}
            >
              What you changed here is not saved yet.
            </ConfirmDialog>
          )}
        </UnsavedCtx.Provider>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
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
  cancelLabel?: string;
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
      <ModalFooter>
        {/* Focus starts on Cancel: every confirm here is destructive, so a stray Enter must not fire it. */}
        <Button variant="secondary" onClick={onCancel} disabled={busy} data-autofocus>
          {cancelLabel}
        </Button>
        <Button variant={danger ? 'needs' : 'primary'} onClick={onConfirm} busy={busy}>
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
