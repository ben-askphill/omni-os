import { useCallback, useEffect, useLayoutEffect, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { takeComposerFocus } from '../../router.ts';
import { Icon, Loader } from '../ui.tsx';


const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? 'Cmd' : 'Ctrl';

export function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string, max: number) {
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [ref, max]);
  useLayoutEffect(fit, [fit, value]);
  // The placeholder counts toward scrollHeight, so a measurement taken before layout or font load
  // settles can come out far too tall. Refit when the width or the fonts change.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    void document.fonts?.ready.then(fit);
    if (typeof ResizeObserver === 'undefined') return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === w) return;
      w = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fit]);
}

export function useFocusRequests(ref: RefObject<HTMLTextAreaElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (takeComposerFocus()) ref.current?.focus();
    const on = () => {
      takeComposerFocus();
      ref.current?.focus();
    };
    window.addEventListener('omni:focus-composer', on);
    return () => window.removeEventListener('omni:focus-composer', on);
  }, [ref, enabled]);
}

/** Bencho "cmd" go button: quiet until there is something to send, then ink. */
/** Where Send sits, while a turn runs and the box is empty: stops the turn. Esc does the same. */
export function StopButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  const label = busy ? 'Stopping' : 'Stop';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      aria-keyshortcuts="Escape"
      title="Stop the agent (Esc). Messages already sent still run."
      className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-fg text-on-ink transition-[opacity,transform] duration-150 ease-out active:scale-[.92] disabled:opacity-60"
    >
      {busy ? <Loader size={16} /> : <Icon name="stop" size={16} strokeWidth={2} />}
    </button>
  );
}

export function SendButton({ armed, busy, onClick, children }: { armed: boolean; busy: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!armed || busy}
      data-armed={armed || undefined}
      aria-label={typeof children === 'string' ? children : undefined}
      title={typeof children === 'string' ? children : undefined}
      className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-fg text-on-ink transition-[opacity,transform] duration-150 ease-out active:scale-[.92] disabled:opacity-25"
    >
      {busy ? <Loader size={16} /> : <Icon name="send" size={16} strokeWidth={2} />}
      <span className="sr-only">{children}</span>
    </button>
  );
}

/** A composer's placeholder, with the two keys that open a menu. */
export const withKeys = (text: string) => `${text} · / commands, @ files`;

/**
 * Enter sends, Shift+Cmd/Ctrl+Enter interrupts, Cmd/Ctrl+Enter inserts a newline (Shift+Enter keeps the
 * textarea's own). Null for every other key, and for the Enter that ends an IME composition (229: Safari's,
 * which it doesn't flag as composing). Prevents the default for the keys it acts on.
 */
export function enterKey(e: ReactKeyboardEvent<HTMLTextAreaElement>, text: string, onText: (text: string) => void): 'send' | 'interrupt' | null {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229 || e.altKey) return null;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod && e.shiftKey) return null;
  e.preventDefault();
  if (mod && e.shiftKey) return 'interrupt';
  if (!mod) return 'send';
  const el = e.currentTarget;
  const at = el.selectionStart + 1;
  onText(text.slice(0, el.selectionStart) + '\n' + text.slice(el.selectionEnd));
  requestAnimationFrame(() => el.setSelectionRange(at, at));
  return null;
}

export const shell = (shape: string, over = false) =>
  `${shape} relative transition-[background-color,box-shadow] duration-[160ms] ease-out focus-within:bg-bg ${
    over
      ? 'bg-bg shadow-[inset_0_0_0_1px_var(--line-strong),0_0_0_4px_var(--wash)]'
      : 'focus-within:shadow-[inset_0_0_0_1px_var(--line-strong),0_0_0_4px_var(--wash)]'
  }`;

export function DropHint({ over }: { over: boolean }) {
  if (!over) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[inherit] bg-bg/85">
      <span className="flex items-center gap-2 text-[13px] font-medium text-fg-2">
        <Icon name="paperclip" size={15} /> Drop to attach
      </span>
    </div>
  );
}
