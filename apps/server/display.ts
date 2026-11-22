// The display switches (packages/shared/display.ts): Show technical details, the Shopify add-on and the Open items
// card. Kept in kv, so they sync to the user's other machines like the rest of their preferences.
//
// The first read seeds them. An install that already has threads is one from before the switches: it keeps the
// technical detail it had, and the add-on stays on when a channel has a store domain or Portal slug. A new install
// starts with both off. The Open items card starts off on every install.
import { db, kv } from './db.ts';
import { publishFeed } from './bus.ts';
import { parseDisplay, type DisplayPrefs } from '@omni/shared/display.ts';

export const DISPLAY_KEY = 'display';

/** What an install from before the switches had: everything shown, the add-on where a channel uses it. */
function seed(): DisplayPrefs {
  const existing = !!db.prepare('SELECT 1 FROM threads LIMIT 1').get();
  const shop = !!db.prepare("SELECT 1 FROM channels WHERE COALESCE(store_domain, '') <> '' OR COALESCE(portal_slug, '') <> '' LIMIT 1").get();
  return { technical: existing, shopify: shop, openItems: false };
}

export function displayPrefs(): DisplayPrefs {
  const saved = kv.get<unknown>(DISPLAY_KEY);
  if (saved !== undefined) return parseDisplay(saved);
  const first = seed();
  kv.set(DISPLAY_KEY, first);
  return first;
}

/**
 * The words Auto reads as a connector need on top of its own (harness/auto.ts NeedOptions). With the Shopify add-on on,
 * channels carry a client portal slug, so "portal" names that portal's connector.
 */
export const autoNeedOptions = () => ({ connectors: displayPrefs().shopify ? ['portal'] : [] });

export function setDisplayPrefs(patch: Partial<DisplayPrefs>): DisplayPrefs {
  const next = { ...displayPrefs(), ...patch };
  kv.set(DISPLAY_KEY, next);
  publishFeed({ type: 'display' });
  return next;
}
