import { useState } from 'react';
import { api, errorText, type PendingMsg, type Thread } from '../api.ts';
import { Button } from '../components/ui.tsx';
import { LIMIT_ACTION } from '../limits.ts';
import { href } from '../router.ts';
import { useApp } from '../store.tsx';
import type { NeedsAction, NeedsCard } from './activity.ts';
import { useShell } from './shell.tsx';

/** What the recovery routes answer with: the thread and its pending list as they are now. */
export type Recovered = { thread: Thread; pending: PendingMsg[] };

const ROUTE: Partial<Record<NeedsAction['kind'], (a: NeedsAction) => string>> = {
  retry: () => 'setup/retry',
  resume: () => 'requests/resume',
  limit: (a) => `limit/${a.kind === 'limit' ? LIMIT_ACTION[a.action].path : ''}`,
};

const DONE: Partial<Record<NeedsAction['kind'], string>> = { retry: 'Preparing the worktree again', resume: 'Resumed', read: 'Marked read', done: 'Marked done' };

/** Runs a card's action. `onRecovered` gets the thread page's answer, so an open thread shows it before the stream does. */
export function useNeedsAction(onRecovered?: (r: Recovered) => void) {
  const shell = useShell();
  const { readResult, setDone } = useApp();
  const [busy, setBusy] = useState<NeedsAction | null>(null);
  const run = async (card: Pick<NeedsCard, 'id'>, a: NeedsAction) => {
    if (a.kind === 'open') return shell.open(href.thread(card.id));
    if (a.kind === 'read') {
      readResult(a.uid);
      return shell.toast(DONE.read!);
    }
    setBusy(a);
    if (a.kind === 'done') {
      try {
        await setDone(card.id, true);
        shell.toast(DONE.done!);
      } catch (e) {
        shell.toast(errorText(e));
      } finally {
        setBusy(null);
      }
      return;
    }
    const route = ROUTE[a.kind]!(a);
    try {
      const res = await api.post<Recovered>(`/threads/${encodeURIComponent(card.id)}/${route}`, {});
      onRecovered?.(res);
      shell.toast(DONE[a.kind] ?? a.label);
    } catch (e) {
      shell.toast(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return { run, busy };
}

/** A card's buttons on their own: under a delegated thread's row, whose pill already says why it waits. */
export function NeedsActions({ card, size = 'lg', onRecovered }: { card: NeedsCard; size?: 'md' | 'lg'; onRecovered?: (r: Recovered) => void }) {
  const { run, busy } = useNeedsAction(onRecovered);
  return (
    <div className="flex flex-wrap gap-2">
      {card.actions.map((a, i) => (
        <Button
          key={a.label}
          size={size}
          variant={i ? 'secondary' : card.glyph === 'needs' ? 'needs' : 'primary'}
          busy={busy === a}
          disabled={!!busy}
          onClick={() => void run(card, a)}
        >
          {a.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * The decision card (MoDecision) in a thread: why it waits on Ben and the buttons that answer it. It has no header,
 * which would only repeat the thread's own.
 */
export function NeedsCardView({ card, onRecovered }: { card: NeedsCard; onRecovered?: (r: Recovered) => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-[20px] bg-surface p-3.5">
      <span className="text-[16px] leading-[1.3] font-medium text-pretty">{card.label}</span>
      {card.detail && <p className="m-0 line-clamp-4 text-[14px] leading-[1.5] text-pretty text-fg-2">{card.detail}</p>}
      <NeedsActions card={card} onRecovered={onRecovered} />
    </div>
  );
}
