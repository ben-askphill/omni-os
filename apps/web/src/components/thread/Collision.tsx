// A collision flag (ADR 0019, Q23, Q56): a file two of the thread's agents both edited. It names the file with its
// folder (`thread/Composer.tsx`) and shows the full path on hover. It clears at the next commit, which only the lead
// makes, or sooner when Ben dismisses it. The transcript draws it above a turn's lanes; Changes lists the open ones
// over the diff and marks their files. Rows in @omni/shared/collisions.ts.
import { useState } from 'react';
import type { Collision } from '@omni/shared/collisions.ts';
import { crewRoleName } from '@omni/shared/crew-role.ts';
import { api, errorText } from '../../api.ts';
import { useCrewRoles } from '../../store.tsx';
import { Button, Icon } from '../ui.tsx';

const list = (names: readonly string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** The agents a flag names, by their names now. */
export function useAgentNames(ids: readonly string[]) {
  const crew = useCrewRoles();
  return ids.map((id) => crewRoleName(id, crew));
}

/** Take a flag down. Resolves with the flags still up, or throws with why. */
export const dismissCollision = (threadId: string, id: number) =>
  api.post<{ collisions: Collision[] }>(`/threads/${encodeURIComponent(threadId)}/collisions/${id}/dismiss`).then((r) => r.collisions);

/** One flag. `onDismissed`: the flags still up, after Ben dismissed this one. */
export function CollisionFlag({ c, threadId, onDismissed, compact = false }: { c: Collision; threadId: string; onDismissed?: (open: Collision[]) => void; compact?: boolean }) {
  const names = useAgentNames(c.agents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dismiss = async () => {
    setBusy(true);
    setError(null);
    try {
      // Not inside `onDismissed?.(...)`: with no `onDismissed`, that skips its arguments, and the dismissal with them.
      const open = await dismissCollision(threadId, c.id);
      onDismissed?.(open);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const cleared = c.cleared === 'commit' ? 'Cleared at the commit' : c.cleared === 'dismiss' ? 'Dismissed' : null;
  return (
    <div
      data-collision={c.path}
      data-cleared={c.cleared ?? undefined}
      className={`collision-flag flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[18px] px-3.5 py-2.5 ${cleared ? 'collision-flag-cleared' : ''}`}
    >
      <Icon name="alert" size={15} className={`shrink-0 ${cleared ? 'text-fg-3' : 'text-warn'}`} />
      <span className="min-w-0 flex-1 text-[13px] leading-[1.45]">
        <span className="font-medium">Both edited</span>{' '}
        <span className="font-mono text-[12px]" title={c.path}>
          {c.label}
        </span>
        {!compact && <span className="text-fg-3"> · {cleared ?? `${list(names)} were each told.`}</span>}
        {compact && cleared && <span className="text-fg-3"> · {cleared}</span>}
      </span>
      {!cleared && (
        <Button size="sm" variant="ghost" busy={busy} onClick={() => void dismiss()}>
          Dismiss
        </Button>
      )}
      {error && <span className="basis-full text-[12px] text-needs">{error}</span>}
    </div>
  );
}

/** The flags still up, over Changes' diff. Null with none. */
export function CollisionBanner({ collisions, threadId, onChanged }: { collisions: readonly Collision[] | undefined; threadId: string; onChanged?: (open: Collision[]) => void }) {
  const open = (collisions ?? []).filter((c) => !c.cleared);
  if (!open.length) return null;
  return (
    <div className="space-y-1.5" aria-label="Files two agents both edited">
      {open.map((c) => (
        <CollisionFlag key={c.key} c={c} threadId={threadId} onDismissed={onChanged} />
      ))}
    </div>
  );
}

/** A file row's flag in Changes: the file is one two agents both edited. */
export function CollisionMark({ path, collisions }: { path: string; collisions: readonly Collision[] | undefined }) {
  const hit = collisions?.find((c) => c.path === path && !c.cleared);
  const names = useAgentNames(hit?.agents ?? []);
  if (!hit) return null;
  const said = `${list(names)} both edited this file`;
  return (
    <span role="img" aria-label={said} title={said} className="inline-grid shrink-0 place-items-center text-warn" data-collision-mark>
      <Icon name="alert" size={13} />
    </span>
  );
}
