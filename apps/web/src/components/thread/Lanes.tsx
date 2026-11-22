// A message several agents answered (ADR 0019, Q55, Q62): a lane per agent with its steps, its reply and the files it
// changed, and the collision flags raised meanwhile above the lanes. Two lanes sit side by side where the column is
// wide enough; from three agents they stack, each collapsed to its latest line until Ben opens it. The lanes stay
// lanes in the history. The desktop transcript draws it; the phone draws one lane per tab (mobile/ThreadTurn.tsx).
// The fold is @omni/shared/lanes.ts.
import { useState, type ReactNode } from 'react';
import { lanesEnded, type Lane, type LanesItem } from '@omni/shared/lanes.ts';
import { turnSteps, showsSteps, type StepsView } from '@omni/shared/steps.ts';
import type { Collision } from '@omni/shared/collisions.ts';
import { AgentAvatar, useAgent } from '../AgentAvatar.tsx';
import { Icon, StatusDot } from '../ui.tsx';
import { CollisionFlag, CollisionMark } from './Collision.tsx';
import { collisionLabel } from '@omni/shared/collisions.ts';
import type { Item } from '@omni/shared/transcript-fold.ts';

const STATE_MARK = { done: 'done', failed: 'failed', stopped: 'stopped', working: 'working' } as const;
const STATE_WORD = { done: 'Done', failed: 'Failed', stopped: 'Stopped', working: 'Working' } as const;

/** How a lane draws its items: the transcript's own rows, with a finished lane's steps folded onto its first calls. */
export type LaneItems = (items: readonly Item[], steps: StepsView | null) => ReactNode;

/**
 * A lane's agent, name and state. `live`: some lane of the message still works, so each face shows its own lane's
 * state; once they all ended, the lanes are history and their faces stay idle (ADR 0021, D11).
 */
function LaneHead({ lane, open, live, onToggle }: { lane: Lane; open: boolean; live: boolean; onToggle?: () => void }) {
  const agent = useAgent(lane.agent) ?? { id: lane.agent, name: lane.agent };
  const working = lane.state === 'working';
  const body = (
    <>
      <AgentAvatar agent={agent} size={22} shows={live ? { member: lane.state } : undefined} placement={live ? 'focus' : 'still'} />
      <span className="shrink-0 text-[13px] font-medium text-fg">{agent.name}</span>
      {!open && lane.latest && <span className={`min-w-0 flex-1 truncate text-[12.5px] ${working ? 'shimmer-text text-fg-2' : 'text-fg-3'}`}>{lane.latest}</span>}
      <span className={`flex shrink-0 items-center gap-1.5 text-[11.5px] text-fg-3 ${open || !lane.latest ? 'ml-auto' : ''}`}>
        <StatusDot mark={STATE_MARK[lane.state]} size={7} />
        {STATE_WORD[lane.state]}
      </span>
      {onToggle && <Icon name="chevronDown" size={14} className={`shrink-0 text-fg-3 transition-transform ${open ? 'rotate-180' : ''}`} />}
    </>
  );
  return onToggle ? (
    <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full min-w-0 items-center gap-2 text-left">
      {body}
    </button>
  ) : (
    <div className="flex min-w-0 items-center gap-2">{body}</div>
  );
}

function LaneFiles({ lane, flags }: { lane: Lane; flags: readonly Collision[] }) {
  if (!lane.files.length) return null;
  return (
    <ul className="mt-2.5 space-y-0.5 border-t border-line pt-2" aria-label={`Files ${lane.agent} changed`}>
      {lane.files.map((f) => {
        const hit = flags.some((c) => c.path === f && !c.cleared);
        return (
          <li key={f} className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-[12px] ${hit ? 'lane-file-hit' : ''}`}>
            {hit ? <CollisionMark path={f} collisions={flags} /> : <Icon name="file" size={13} className="shrink-0 text-fg-3" />}
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" title={f}>
              {collisionLabel(f)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function LaneCard({ lane, flags, render, stacked, live }: { lane: Lane; flags: readonly Collision[]; render: LaneItems; stacked: boolean; live: boolean }) {
  // Stacked lanes open collapsed to their latest line; side by side, each shows whole.
  const [open, setOpen] = useState(!stacked);
  const working = lane.state === 'working';
  const steps = turnSteps(lane.items, { live: working });
  const shownSteps = showsSteps(steps) ? steps : null;
  return (
    <section className="lane min-w-0 px-3.5 pt-3 pb-2.5" data-lane={lane.agent} data-state={lane.state}>
      <LaneHead lane={lane} open={open} live={live} onToggle={stacked ? () => setOpen((o) => !o) : undefined} />
      {open && (
        <div className="mt-2.5 min-w-0 space-y-3">
          {render(lane.items, working ? null : shownSteps)}
          {working && shownSteps && render([], shownSteps)}
          {working && lane.latest && (
            <div className="flex min-w-0 items-center gap-2 text-[12.5px]">
              <StatusDot mark="working" size={8} />
              <span className="shimmer-text min-w-0 truncate font-medium">{lane.latest}</span>
            </div>
          )}
          {working && !lane.latest && (
            <div className="flex min-w-0 items-center gap-2 text-[12.5px] text-fg-3">
              <StatusDot mark="starting" size={8} />
              Starting
            </div>
          )}
        </div>
      )}
      {open && <LaneFiles lane={lane} flags={flags} />}
    </section>
  );
}

/** The lanes of one message, with its collision flags above them. */
export function LanesBlock({ block, threadId, render }: { block: LanesItem; threadId: string; render: LaneItems }) {
  return (
    <div className="space-y-3" data-lanes={block.key}>
      {block.flags.length > 0 && (
        <div className="space-y-1.5">
          {block.flags.map((c) => (
            <CollisionFlag key={c.key} c={c} threadId={threadId} />
          ))}
        </div>
      )}
      <div className="@container">
        <div className={`grid grid-cols-1 gap-3 ${block.stacked ? '' : '@xl:grid-cols-2'}`}>
          {block.lanes.map((lane) => (
            <LaneCard key={lane.agent} lane={lane} flags={block.flags} render={render} stacked={block.stacked} live={!lanesEnded(block)} />
          ))}
        </div>
      </div>
    </div>
  );
}
