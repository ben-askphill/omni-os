import { useRef, useState } from 'react';
import { OWNER_MAX, ownerLabel } from '@omni/shared/thread-owner.ts';
import { api, errorText, type Thread } from '../../api.ts';
import { useUserName } from '../../store.tsx';
import { ErrorNote } from '../ui.tsx';
import { isImeEnter } from '../../ime.ts';

/**
 * Who the thread is for (thread-owner.ts): "You", or the person named, with Change to type another name. An empty
 * name gives it back to the user. The thread comes back on the feed, so the field shows the saved name.
 */
export function OwnerField({ thread, className = '' }: { thread: Pick<Thread, 'id' | 'owner'>; className?: string }) {
  const userName = useUserName();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Escape closes the field without saving; the blur that follows must not save it either.
  const dropped = useRef(false);
  const save = async () => {
    if (draft === null || dropped.current) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/threads/${encodeURIComponent(thread.id)}`, { owner: draft });
      setDraft(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  if (draft === null)
    return (
      <span className={`flex min-w-0 items-center gap-2 ${className}`} data-owner={thread.owner ?? ''}>
        <span className="min-w-0 truncate">{ownerLabel(thread.owner, userName)}</span>
        <button type="button" className="shrink-0 text-fg-3 underline-offset-2 hover:text-fg hover:underline" onClick={() => ((dropped.current = false), setDraft(thread.owner ?? ''))}>
          Change
        </button>
      </span>
    );
  return (
    <span className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <input
        className="field field-xs h-8 w-full max-sm:!text-[length:var(--fs-input)]"
        value={draft}
        maxLength={OWNER_MAX}
        placeholder="A name, or empty for you"
        aria-label="Owner"
        autoFocus
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isImeEnter(e)) (e.preventDefault(), void save());
          if (e.key === 'Escape') (e.stopPropagation(), (dropped.current = true), setDraft(null));
        }}
        onBlur={() => void save()}
      />
      {error && <ErrorNote>{error}</ErrorNote>}
    </span>
  );
}
