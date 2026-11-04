import type { ReactNode } from 'react';

/**
 * A running thread on its way to another synced Mac, in the transcript column. Copy from packages/shared/handoff.ts
 * handoffText:
 * - giving Mac, preparing (tone working, Cancel): "Handing off to Ben's MacBook Pro: uploading the session."
 * - giving Mac, offered (tone waiting, Cancel): "Waiting for Ben's MacBook Pro to pick it up."
 * - giving Mac, offered past 90s (tone alert, Cancel): "Ben's MacBook Pro has not picked this thread up yet. It may be
 *   asleep or not running Omni."
 * - taking Mac (tone working, no button): "Ben's MacBook Air is handing this thread to this Mac."
 * - failed (tone alert, no button): "The handoff to Ben's MacBook Pro failed: <why>. The thread is stopped here; reply
 *   to continue it."
 * `note` carries what stays behind, e.g. "~/work/shop has uncommitted changes on Ben's MacBook Air; they stay there."
 * Vermilion only for alert: a handoff in progress is not something that needs you.
 * @startingPoint section="Thread" subtitle="Handoff card, line and device picker" viewport="760x620"
 */
export function HandoffCard(props: {
  tone?: 'working' | 'waiting' | 'alert';
  children?: ReactNode;
  note?: ReactNode;
  /** Cancel handoff, on the giving Mac until the other one takes it. */
  cancel?: boolean;
  /** Phone layout: no border, 20px radius. */
  mobile?: boolean;
}): JSX.Element;

/** A settled handoff, one quiet line: "Running on Ben's MacBook Pro. Handed off from this Mac." or a cancel. */
export function HandoffLine(props: { tone?: 'done' | 'cancelled'; children?: ReactNode }): JSX.Element;

/**
 * The other synced Macs a running thread can go to (GET /api/devices), from the header's share button, the thread's
 * right-click menu, the phone's thread sheet and the Mac app's Hand Off menu. Labels: "Online on Tailscale",
 * "Can't check Tailscale", "Asleep or offline, last seen 3h ago". Offline rows are disabled.
 */
export function DevicePicker(props: {
  devices?: { name: string; reachability: 'online' | 'unknown' | 'offline'; label: string }[];
  error?: ReactNode;
  title?: string;
}): JSX.Element;
