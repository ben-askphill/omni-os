// Who a thread is for and who does it, as separate fields (an issue's assignee and its delegate): `owner` is the person
// accountable, a name, null for the install's own user; the agent is the crew role it runs as (`role`), shown beside
// the harness row the cards already have. The server stores the owner (threads.owner, synced).

/** The longest owner name the API takes. */
export const OWNER_MAX = 80;

/** An owner as stored: one line, trimmed, null when empty or the user's own name (`user`), which is the user's. */
export function ownerName(raw: string | null | undefined, user?: string | null): string | null {
  const s = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, OWNER_MAX);
  return s && s.toLowerCase() !== (user ?? '').trim().toLowerCase() ? s : null;
}

/**
 * Whether a thread is someone else's: its owner is set and is not the user's own name. Cards name only those, so a
 * single-person install shows no owner on any card.
 */
export const ownedByOther = (owner: string | null | undefined, user: string | null | undefined) =>
  !!owner && owner.trim().toLowerCase() !== (user ?? '').trim().toLowerCase();

/** The owner in words: "You" for the user's own, else the name. */
export const ownerLabel = (owner: string | null | undefined, user: string | null | undefined) => (ownedByOther(owner, user) ? owner!.trim() : 'You');

/** The Agent row of a thread that runs as no agent, muted like No branch. */
export const NO_CREW_ROLE = 'No agent';
