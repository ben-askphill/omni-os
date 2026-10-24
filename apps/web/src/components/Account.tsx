import { useEffect, useState } from 'react';
import { errorText, signOut, startGoogleSignIn, useApi, type AuthState, type SignInAvailability } from '../api.ts';
import { accountView } from '../sign-in.ts';
import { GoogleMark } from './brand.tsx';
import { Button } from './ui.tsx';

// The pieces Settings > Account shares between the desktop page and the phone screen, and the Google button every
// sign-in screen uses. Which of them show is decided in apps/web/src/sign-in.ts.

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
