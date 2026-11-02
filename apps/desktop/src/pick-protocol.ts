// The pick preload's pure half: which requests it answers and which keys it hands to the Web tab. Apart from
// pick-preload.ts, which starts listening as it loads, so tests can import this.
import type { NativeGuestEvent, NativePickRequest } from '@omni/shared/desktop-bridge.ts';

const coord = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 20_000 ? Math.floor(v) : null);

/** A request from the host page, or null for anything else. */
export function pickRequest(raw: unknown): NativePickRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'number' || !Number.isSafeInteger(r.id)) return null;
  if (r.op === 'look') return { id: r.id, op: 'look' };
  if (r.op !== 'inspect' && r.op !== 'pick') return null;
  const x = coord(r.x);
  const y = coord(r.y);
  return x === null || y === null ? null : { id: r.id, op: r.op, x, y };
}

type Key = Extract<NativeGuestEvent, { type: 'key' }>['key'];
const SHORTCUTS = new Set<string>(['l', 'r', '[', ']']);

/**
 * The key the Web tab handles, or null for one that is the page's alone. Its shortcuts use Cmd on a Mac, Ctrl elsewhere.
 * Only a key Ben pressed counts: a page's script cannot reload the tab, move its history or switch Annotate's modes.
 */
export function guestKey(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isTrusted'>, mac: boolean): Key | null {
  if (!e.isTrusted) return null;
  if (e.key === 'Escape') return 'Escape';
  if (e.key === 'Alt') return 'Alt';
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey || e.shiftKey) return null;
  const key = e.key.toLowerCase();
  return SHORTCUTS.has(key) ? (key as Key) : null;
}
