import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type PRSummary, type Thread } from '../../api.ts';
import { Button, Chip, Icon } from '../ui.tsx';
import { plural, relTime } from '../../format.ts';
import { href } from '../../router.ts';

export const OPEN_PR_PROMPT = 'Commit your work, push the branch and open a PR with gh. Reply with the PR URL.';

/** open, draft, merged or closed, with the chip tone the PRs page uses. */
function prBadge(p: PRSummary) {
  const state = p.state ?? 'OPEN';
  const label = state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : p.isDraft ? 'draft' : 'open';
  return { label, tone: (label === 'open' ? 'live' : label === 'merged' ? 'done' : 'outline') as 'live' | 'done' | 'outline' };
}

/**
 * The composer's PR slot: Open PR until the branch has a PR, then that PR and whether it merged.
 * It opens a list of every PR from the branch, and offers Open PR there while none is open.
 */
export function ThreadPR({ thread, slotBusy, busy, onOpen }: { thread: Thread; slotBusy: boolean; busy: boolean; onOpen: () => void }) {
  // undefined until the first answer, so the button does not flash before the PR shows.
  const [data, setData] = useState<{ pr: PRSummary | null; prs: PRSummary[] } | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try {
      const r = await api.get<{ pr: PRSummary | null; prs?: PRSummary[] }>(`/threads/${encodeURIComponent(thread.id)}/pr`);
      setData({ pr: r.pr, prs: r.prs ?? (r.pr ? [r.pr] : []) });
    } catch {
      setData((prev) => prev ?? { pr: null, prs: [] });
    }
  }, [thread.id]);
  // Again when a turn ends (it may have opened the PR), and every minute to catch a merge.
  useEffect(() => {
    if (!slotBusy) void load();
  }, [load, slotBusy, thread.branch]);
  useEffect(() => {
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    return () => clearInterval(tick);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!data) return null;
  const { pr, prs } = data;
  if (!pr)
    return (
      <Button size="sm" variant="ghost" icon="pr" onClick={onOpen} busy={busy} title={OPEN_PR_PROMPT}>
        Open PR
      </Button>
    );
  const badge = prBadge(pr);
  const canOpen = !prs.some((p) => (p.state ?? 'OPEN') === 'OPEN');
  return (
    <div ref={wrap} className="relative">
      <Button
        size="sm"
        variant="ghost"
        icon="pr"
        busy={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title={pr.title}
        onClick={() => setOpen((v) => !v)}
        className="gap-1.5"
      >
        #{pr.number}
        <Chip tone={badge.tone}>{badge.label}</Chip>
        {prs.length > 1 && <span className="text-fg-4">+{prs.length - 1}</span>}
        <Icon name="chevronDown" size={13} className="text-fg-4" />
      </Button>
      {open && (
        <div role="menu" aria-label="Pull requests from this branch" data-up className="pik-card bottom-[calc(100%+8px)] left-0 w-[min(340px,calc(100vw-32px))]">
          <div className="px-2 pt-1 pb-1.5 text-[11.5px] text-fg-4">
            {plural(prs.length, 'PR')} from <span className="font-mono">{thread.branch}</span>
          </div>
          <div className="scroll-thin max-h-[280px] overflow-y-auto">
            {prs.map((p) => {
              const b = prBadge(p);
              return (
                <a
                  key={p.number}
                  role="menuitem"
                  href={href.pr(thread.channel_id, p.number)}
                  onClick={() => setOpen(false)}
                  className="pik-row hover:bg-[var(--wash)]"
                >
                  <span className="w-9 shrink-0 text-[12.5px] text-fg-3 tabular-nums">#{p.number}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] text-fg">{p.title}</span>
                    <span className="truncate text-[11.5px] text-fg-4">{relTime(p.updatedAt)}</span>
                  </span>
                  <Chip tone={b.tone}>{b.label}</Chip>
                </a>
              );
            })}
          </div>
          {canOpen && (
            <button
              type="button"
              role="menuitem"
              title={OPEN_PR_PROMPT}
              onClick={() => {
                setOpen(false);
                onOpen();
              }}
              className="pik-row mt-1 text-[13px] text-fg-2 shadow-[inset_0_1px_0_var(--line)] hover:bg-[var(--wash)]"
            >
              <Icon name="pr" size={14} /> Open a new PR
            </button>
          )}
        </div>
      )}
    </div>
  );
}
