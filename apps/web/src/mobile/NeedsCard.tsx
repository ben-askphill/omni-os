import { useState } from 'react';
import { api, errorText, type PendingMsg, type Thread } from '../api.ts';
import { Button } from '../components/ui.tsx';
import { LIMIT_ACTION } from '../limits.ts';
import { href } from '../router.ts';
import { useApp } from '../store.tsx';
import type { NeedsAction, NeedsCard } from './activity.ts';
import { MoAvatar } from './parts.tsx';
import { useShell } from './shell.tsx';

/** What the recovery routes answer with: the thread and its pending list as they are now. */
export type Recovered = { thread: Thread; pending: PendingMsg[] };

const ROUTE: Partial<Record<NeedsAction['kind'], (a: NeedsAction) => string>> = {
  retry: () => 'setup/retry',
  resume: () => 'requests/resume',
  limit: (a) => `limit/${a.kind === 'limit' ? LIMIT_ACTION[a.action].path : ''}`,
};

const DONE: Partial<Record<NeedsAction['kind'], string>> = { retry: 'Preparing the worktree again', resume: 'Resumed', read: 'Marked read' };

/** Runs a card's action. `onRecovered` gets the thread page's answer, so an open thread shows it before the stream does. */
export function useNeedsAction(onRecovered?: (r: Recovered) => void) {
  const shell = useShell();
  const { readResult } = useApp();
  const [busy, setBusy] = useState<NeedsAction | null>(null);
  const run = async (card: Pick<NeedsCard, 'id'>, a: NeedsAction) => {
    if (a.kind === 'open') return shell.open(href.thread(card.id));
    if (a.kind === 'read') {
      readResult(a.uid);
      return shell.toast(DONE.read!);
    }
    const route = ROUTE[a.kind]!(a);
    setBusy(a);
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
 * The decision card (MoDecision): why a thread waits on Ben and the buttons that answer it, the same in Activity and
 * in the thread. In the thread it drops the header, which would only repeat the thread's own.
 */
export function NeedsCardView({ card, inThread, onRecovered }: { card: NeedsCard; inThread?: boolean; onRecovered?: (r: Recovered) => void }) {
  const shell = useShell();
  const t = card.thread;
  return (
    <div className="flex flex-col gap-3 rounded-[20px] bg-surface p-3.5">
      {inThread ? (
        <span className="text-[16px] leading-[1.3] font-medium text-pretty">{card.label}</span>
      ) : (
        <button type="button" onClick={() => shell.open(href.thread(t.id))} className="flex items-start gap-3 text-left">
          <MoAvatar role={t.role} channel={t.channel_id} channelIcon={card.channelIcon} state={card.glyph} />
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="truncate text-[12px] leading-[1.3] text-fg-3">{card.meta}</span>
            <span className="text-[16px] leading-[1.3] font-medium text-pretty">{t.title || 'Untitled'}</span>
          </span>
          <span className="shrink-0 text-[12px] leading-[1.3] text-fg-3 tabular-nums">{card.time}</span>
        </button>
      )}
      {(inThread ? card.detail : true) && (
        <p className="m-0 line-clamp-4 text-[14px] leading-[1.5] text-pretty text-fg-2">
          {!inThread && <span className="text-fg">{card.label}</span>}
          {!inThread && card.detail && ' · '}
          {card.detail}
        </p>
      )}
      <NeedsActions card={card} onRecovered={onRecovered} />
    </div>
  );
}
