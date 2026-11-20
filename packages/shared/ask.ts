// Asks sent before group threads (ADR 0019): an Ask started a thread on the asked agent under the asking one, and its
// answer came back as a crew report. Seating replaced it, so nothing sends an Ask any more (an older client's becomes a
// seat, apps/server/ask-api.ts). What stays is how an Ask already in a transcript reads. Pure.

/**
 * The `ask` event in the asking thread: Ben's question and where it went. Clients show it with the Ask's live state,
 * and the report on it once it answers.
 */
export interface AskP {
  /** The Ask's own thread. */
  thread_id: string;
  role: string;
  /** The role's name when Ben asked. */
  name: string;
  harness: string;
  harness_name: string;
  remote: boolean;
  question: string;
  /** What went along of this thread, or null when no excerpt did. */
  excerpt: { entries: number; total: number; chars: number } | null;
  wake: boolean;
  title: string;
  channel: string;
}

/** The chip that named an Ask's agent: who it went to, and that it ran elsewhere. */
const askLabel = (role: Pick<AskP, 'name' | 'remote'>) => `Ask ${role.name}${role.remote ? ' (remote)' : ''}`;

/** The line over a sent Ask's question: who it went to, what went along, and what the answer does here. */
export function askCaption(p: Pick<AskP, 'name' | 'remote' | 'excerpt' | 'wake'>): string {
  const along = p.excerpt ? `with ${p.excerpt.entries} ${p.excerpt.entries === 1 ? 'message' : 'messages'} of this thread` : 'no thread excerpt';
  return [askLabel(p).replace(/^Ask /, 'Asked '), along, p.wake ? 'the answer wakes this thread' : 'the answer only shows here'].join(' · ');
}
