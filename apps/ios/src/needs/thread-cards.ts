import type { PendingMsg, Thread } from '@omni/client-core';

import type { NeedsAction } from './actions';
import { harnessLabel, LIMIT_LABEL, limitView } from './limit';
import { isOmnis, isParked, parkedHeading, parkedLabel } from './parked';

export interface CardButton {
  /** Names the button while its call runs, so only that one shows busy. */
  key: string;
  label: string;
  action: NeedsAction;
  primary: boolean;
}

export interface ParkedRow {
  uuid: string;
  text: string;
  label: string;
  buttons: CardButton[];
}

/** What a thread that waits on Ben shows above its composer, in the order it shows. */
export type ThreadCard =
  | { kind: 'setup'; failed: boolean; title: string; body: string; detail: string | null; branch: string | null; buttons: CardButton[] }
  | { kind: 'limit'; title: string; body: string; scheduled: boolean; buttons: CardButton[] }
  | { kind: 'parked'; heading: string; rows: ParkedRow[]; buttons: CardButton[] };

const SETUP_WAIT = 'Sends once the worktree is ready';

function setupCard(thread: Thread): ThreadCard | null {
  if (thread.setup === 'preparing') {
    return {
      kind: 'setup',
      failed: false,
      title: 'Preparing worktree',
      body: 'Nothing runs before the agent starts. Your message and files wait below.',
      detail: null,
      branch: thread.branch,
      buttons: [],
    };
  }
  if (thread.setup === 'failed') {
    return {
      kind: 'setup',
      failed: true,
      title: thread.status === 'stopped' ? 'Setup stopped' : 'Setup failed',
      body: 'The agent did not start. Your message and files are kept and send once the worktree is ready.',
      detail: thread.setup_error,
      branch: thread.branch,
      buttons: [{ key: 'retry', label: 'Retry setup', action: { kind: 'retry-setup' }, primary: true }],
    };
  }
  return null;
}

function limitCard(thread: Thread, now: number): ThreadCard | null {
  const view = limitView(thread, harnessLabel(thread.harness), now);
  if (!view) return null;
  return {
    kind: 'limit',
    title: view.title,
    body: view.body,
    scheduled: view.scheduled,
    buttons: view.actions.map((a, i) => ({ key: `limit:${a}`, label: LIMIT_LABEL[a], action: { kind: 'limit', action: a }, primary: i === 0 })),
  };
}

function parkedCard(thread: Thread, pending: readonly PendingMsg[], blocked: boolean): ThreadCard | null {
  const parked = pending.filter(isParked);
  if (parked.length === 0) return null;
  const waitingOnWorktree = thread.setup !== null;
  const recovered = parked.filter((m) => m.delivery === 'recovered').length;
  const rows = parked.map((m): ParkedRow => {
    const buttons: CardButton[] = [];
    if (m.delivery === 'uncertain') {
      buttons.push({ key: `again:${m.uuid}`, label: 'Send again', action: { kind: 'resume', ids: [m.uuid] }, primary: false });
    }
    if (isOmnis(m)) buttons.push({ key: `discard:${m.uuid}`, label: 'Discard', action: { kind: 'discard', id: m.uuid }, primary: false });
    return {
      uuid: m.uuid,
      text: m.text,
      label: waitingOnWorktree ? 'Waits for the worktree' : (parkedLabel(m, blocked) ?? 'Held for Resume'),
      buttons,
    };
  });
  return {
    kind: 'parked',
    heading: waitingOnWorktree ? SETUP_WAIT : parkedHeading(parked, blocked),
    rows,
    buttons:
      recovered > 0 && !waitingOnWorktree
        ? [{ key: 'resume', label: recovered > 1 ? `Resume ${recovered}` : 'Resume', action: { kind: 'resume' }, primary: true }]
        : [],
  };
}

export function threadCards(input: { thread: Thread; pending: readonly PendingMsg[]; blocked: boolean; now: number }): ThreadCard[] {
  const { thread, pending, blocked, now } = input;
  return [setupCard(thread), limitCard(thread, now), parkedCard(thread, pending, blocked)].filter((c): c is ThreadCard => c !== null);
}

/** The pending messages the agent has, as opposed to the ones parked on Ben. */
export const liveMessages = (pending: readonly PendingMsg[]) => pending.filter((m) => !isParked(m));
