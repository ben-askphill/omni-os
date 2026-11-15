// Marking a thread done, everywhere the Web UI offers it (the Inbox card and E, Needs you, the thread header and menus,
// the phone's rows and sheets). A job with threads under it that still run, failed or wait on Ben asks first, since
// done hides it from the Inbox with that work unfinished. With all of them finished it is one click, as before.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildTree, doneNeedsConfirm, unfinishedLabel } from '@omni/shared/thread-tree.ts';
import { errorText, type Thread } from './api.ts';
import { ConfirmDialog } from './components/ui.tsx';
import { useApp } from './store.tsx';
import { treeSource, useForgetTreeChoices } from './thread-tree.ts';

/** Mark it done (asking first when work under it is unfinished) or not done. Null when Ben cancelled. */
type MarkDone = (t: { id: string; title?: string | null }, on: boolean) => Promise<Thread | null>;

const Ctx = createContext<MarkDone | null>(null);

interface Pending {
  id: string;
  title: string;
  what: string;
  resolve: (t: Thread | null) => void;
}

export function DoneConfirmProvider({ children }: { children: ReactNode }) {
  const { channels, needsYou, setDone } = useApp();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The latest lists, read when Ben asks rather than captured, so a stale closure never skips the question.
  useForgetTreeChoices();
  const source = useRef({ channels, needsYou });
  source.current = { channels, needsYou };

  const markDone = useCallback<MarkDone>(
    (t, on) => {
      if (!on) return setDone(t.id, false);
      const { index, flags } = treeSource(source.current.channels, source.current.needsYou);
      const nodes = buildTree(t.id, index, flags);
      if (!doneNeedsConfirm(nodes)) return setDone(t.id, true);
      return new Promise<Thread | null>((resolve) => {
        setError(null);
        setPending({ id: t.id, title: t.title || 'Untitled', what: unfinishedLabel(nodes), resolve });
      });
    },
    [setDone],
  );

  const close = (result: Thread | null) => {
    pending?.resolve(result);
    setPending(null);
    setBusy(false);
  };
  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      close(await setDone(pending.id, true));
    } catch (e) {
      setBusy(false);
      setError(errorText(e));
    }
  };

  return (
    <Ctx.Provider value={markDone}>
      {children}
      <ConfirmDialog
        open={!!pending}
        title="Mark as done?"
        confirmLabel="Mark as done"
        busy={busy}
        error={error}
        onConfirm={() => void confirm()}
        onCancel={() => close(null)}
      >
        <p>
          Under <span className="font-medium text-fg">{pending?.title}</span>, {pending?.what}. Done takes it out of the Inbox and Needs you until something new
          happens in it.
        </p>
      </ConfirmDialog>
    </Ctx.Provider>
  );
}

/** The provider's markDone. Without one (a test rendering a row alone) it marks done straight away. */
export function useMarkDone(): MarkDone {
  const ctx = useContext(Ctx);
  const { setDone } = useApp();
  return useMemo(() => ctx ?? ((t, on) => setDone(t.id, on)), [ctx, setDone]);
}
