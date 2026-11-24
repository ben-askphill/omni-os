// Every harness by id, built-in or custom: what it can do, what it is called, where it runs, and for the Runs API ones
// where to reach them. A custom harness is looked up in its file (custom.ts) on each call, so a deleted file counts at
// once. An id that names nothing here is unknown: it never runs, and never falls back to another harness.
import { isCustomHarnessId } from '@omni/shared/custom-harness.ts';
import { config } from '../config.ts';
import { HERMES_FIX } from './catalog.ts';
import { customHarness, pairable, PAIR_HERE_FIX, type CustomHarness } from './custom.ts';
import { HERMES_KEY } from './env-guard.ts';
import { profileOf } from './profile.ts';
import type { RemoteKind } from './remote.ts';
import { CAPABILITIES, HARNESS_META, isHarnessId, type HarnessCapabilities } from './types.ts';

/** What a thread needs to run on a Runs API server (hermes/adapter.ts): Hermes, or a custom harness. */
export interface RunsApiTarget {
  id: string;
  name: string;
  /** The wire protocol it speaks (remote.ts). */
  kind: RemoteKind;
  /** The base URL. Empty when none is set. */
  url: string;
  /** The secret holding its bearer key. */
  keyName: string;
  capabilities: HarnessCapabilities;
  /** How to make it usable, for a missing key or an unreachable server. */
  fix: string;
  /** Omni paired it, so a refused or missing key is fixed by Pair this machine on its page (custom.ts pairable). */
  pairable?: boolean;
  /** Why it cannot run at all as set up (a custom harness's file error). */
  error?: string;
}

/** Hermes, from Settings (or OMNI_HERMES_URL) and HERMES_API_KEY. */
const hermesTarget = (): RunsApiTarget => ({ id: 'hermes', name: HARNESS_META.hermes.name, kind: 'runs-api', url: config.hermesUrl ?? '', keyName: HERMES_KEY, capabilities: CAPABILITIES.hermes, fix: HERMES_FIX });

/** How to make a custom harness usable once its file is fine. A paired one pairs this machine on its page instead. */
export const customFix = (h: CustomHarness) =>
  pairable(h) ? `${h.name}: ${PAIR_HERE_FIX}` : `Set ${h.secret} in Secrets on this machine to the server's key, and check that ${h.host || 'its server'} is reachable from here`;

/** Hermes or a custom harness with a file here, or null for any other id. */
export function runsApiTarget(id: string | null | undefined): RunsApiTarget | null {
  if (id === 'hermes') return hermesTarget();
  const h = customHarness(id);
  if (!h) return null;
  return { id: h.id, name: h.name, kind: h.kind, url: h.url, keyName: h.secret, capabilities: h.capabilities, fix: customFix(h), ...(pairable(h) && { pairable: true }), ...(h.error && { error: h.error }) };
}

/** A built-in, or a custom harness whose file is on this machine. */
export const knownHarness = (id: string | null | undefined): boolean => isHarnessId(id) || !!customHarness(id);

/** What a harness can do, or null for an id that names no harness here. */
export function capabilitiesOf(id: string | null | undefined): HarnessCapabilities | null {
  if (isHarnessId(id)) return CAPABILITIES[id];
  return customHarness(id)?.capabilities ?? null;
}

/** A harness's display name: the built-in's, the custom harness's own, or the id itself when it names nothing here. */
export function harnessName(id: string): string {
  if (isHarnessId(id)) return HARNESS_META[id].name;
  return customHarness(id)?.name ?? id;
}

/** Where a remote harness runs, for "its files are not on this machine" reasons. */
export function providerWhere(id: string): string {
  return profileOf(id).where ?? `on ${harnessName(id)}'s own server`;
}

/**
 * Why a thread on `id` cannot run on this machine at all, or null when its harness is here. A custom harness whose file
 * is gone (deleted, or not synced here yet) and an id no build knows both refuse: nothing runs in their place.
 */
export function missingHarness(id: string): string | null {
  if (knownHarness(id)) return null;
  if (isCustomHarnessId(id))
    return `This thread runs on the custom harness ${id}, which is not set up on this machine: its file was removed or has not synced here. Omni does not run it on another harness. Add the harness back, or start a new thread on another one.`;
  return `This thread runs on "${id}", a harness this version of Omni does not have. Omni does not run it on another harness.`;
}
