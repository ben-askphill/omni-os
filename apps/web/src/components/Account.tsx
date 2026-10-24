import { useEffect, useState } from 'react';
import { errorText, revokeDevice, signOut, startGoogleSignIn, useApi, type AuthState, type SignInAvailability, type SignedInDevice } from '../api.ts';
import { accountView, deviceRows, type DeviceRow } from '../sign-in.ts';
import { useNow } from '../store.tsx';
import { GoogleMark } from './brand.tsx';
import { Button, ErrorNote, Icon, InlineConfirm, Loading } from './ui.tsx';

// The pieces Settings > Account and > Devices share between the desktop page and the phone screen, and the Google
// button every sign-in screen uses. Which of them show is decided in apps/web/src/sign-in.ts.

/** What Settings > Account shows, or null until the server has answered. */
export function useAccount() {
  const auth = useApi<AuthState>('/auth');
  const availability = useApi<SignInAvailability>('/auth/google');
  return { view: auth.data && availability.data ? accountView(auth.data, availability.data) : null, error: auth.error ?? availability.error };
}

/** Sends this browser to Google. It comes back to the address bar's `?signin=`, which PairGate finishes. */
export function GoogleButton({ variant = 'secondary', size = 'md', className = '', onError }: { variant?: 'primary' | 'secondary'; size?: 'md' | 'lg'; className?: string; onError: (message: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  // Back from Google can restore this page mid-click, with the button still busy.
  useEffect(() => {
    const restored = (e: PageTransitionEvent) => e.persisted && setBusy(false);
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);

  const go = async () => {
    setBusy(true);
    onError(null);
    try {
      window.location.assign(await startGoogleSignIn());
    } catch (err) {
      onError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Button variant={variant} size={size} busy={busy} onClick={() => void go()} className={className}>
      {!busy && <GoogleMark />}
      Sign in with Google
    </Button>
  );
}

export function SignOutButton({ size = 'md', className = '', onError }: { size?: 'md' | 'lg'; className?: string; onError: (message: string | null) => void }) {
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    onError(null);
    try {
      await signOut();
      window.location.reload();
    } catch (err) {
      onError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Button size={size} busy={busy} onClick={() => void go()} className={className}>
      Sign out
    </Button>
  );
}

/** The signed-in devices as rows, and the way to sign one out. Signing out this browser reloads into the pairing screen. */
function useDevices() {
  const list = useApi<SignedInDevice[]>('/auth/devices');
  const now = useNow(60_000);
  const [failed, setFailed] = useState<string | null>(null);

  const revoke = async (row: DeviceRow) => {
    setFailed(null);
    try {
      await revokeDevice(row.id);
      if (row.current) return window.location.reload();
    } catch (err) {
      setFailed(errorText(err));
    }
    list.reload();
  };

  return { rows: list.data ? deviceRows(list.data, now) : null, error: failed ?? list.error, revoke };
}

/** Settings > Devices: the rows, or why there are none, and what the list leaves out. `phone`: the phone layout's list style. */
export function DevicesBody({ phone = false }: { phone?: boolean }) {
  const { rows, error, revoke } = useDevices();
  const muted = `text-[12.5px] leading-[1.45] text-fg-3 ${phone ? 'px-1' : ''}`;
  return (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!rows && !error && <Loading />}
      {rows?.length === 0 && <p className={phone ? 'rounded-[20px] bg-surface px-4 py-3.5 text-[14px] text-fg-3' : muted}>No devices are signed in with Google.</p>}
      {rows && rows.length > 0 && (
        <ul className={phone ? 'overflow-hidden rounded-[20px] bg-surface' : 'space-y-1.5'}>
          {rows.map((row) => (
            <li key={row.id} className={`flex items-center gap-3 px-4 py-2.5 ${phone ? 'min-h-[56px] border-t border-line first:border-t-0' : 'rounded-[16px] bg-bg'}`}>
              <span className="grid shrink-0 text-fg-2">
                <Icon name={row.icon} size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className={`truncate font-medium ${phone ? 'text-[15px]' : 'text-[13.5px]'}`}>{row.name}</div>
                <div className="text-[12.5px] break-words text-fg-3">{row.detail}</div>
              </div>
              <InlineConfirm label="Sign out" confirmLabel="Sign out" busyLabel="Signing out" onConfirm={() => revoke(row)} />
            </li>
          ))}
        </ul>
      )}
      <p className={muted}>
        Scripts, agents and the Mac app’s server check use the install token, which is not listed here. To shut everything out, delete <code className="font-mono">data/api-token</code> and restart Omni.
      </p>
    </>
  );
}
