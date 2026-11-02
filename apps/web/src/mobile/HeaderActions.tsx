import { href } from '../router.ts';
import { useApp } from '../store.tsx';
import { MoRound } from './parts.tsx';
import { useShell } from './shell.tsx';

/**
 * The right side of every tab root's header: search, reload and the account button that opens Settings.
 * Reload is there because a home-screen app has no browser chrome to pull or press.
 */
export function HeaderActions({ searchLabel = 'Search threads' }: { searchLabel?: string }) {
  const shell = useShell();
  const { profile } = useApp();
  const initial = (profile?.name || 'You').trim().slice(0, 1).toUpperCase();
  return (
    <>
      <MoRound icon="search" label={searchLabel} onClick={() => shell.sheet({ name: 'search' })} />
      <MoRound icon="refresh" label="Reload" onClick={() => window.location.reload()} />
      <MoRound label="Settings" onClick={() => shell.open(href.settingsPage())}>
        <span className="font-rounded text-[14px] leading-none font-semibold">{initial}</span>
      </MoRound>
    </>
  );
}
