import type { AuthState, SignInAvailability, SignedInUser } from './api.ts';

// What the Web UI shows about signing in with Google, decided from the server's answers (GET /api/auth and
// GET /api/auth/google). Pure, so tests can run every case. The screens: components/Pair.tsx, components/Onboarding.tsx,
// and the Account sections of pages/Settings.tsx and mobile/SettingsScreen.tsx.

/** `#/t/abc?signin=X` gives `X` and `#/t/abc`: the hash the address bar keeps. */
export function takeHashParam(hash: string, name: string): { value: string | null; rest: string } {
  const at = hash.indexOf('?');
  if (at < 0) return { value: null, rest: hash };
  const q = new URLSearchParams(hash.slice(at + 1));
  const value = q.get(name);
  if (!value) return { value: null, rest: hash };
  q.delete(name);
  const left = q.toString();
  return { value, rest: `${hash.slice(0, at)}${left ? `?${left}` : ''}` };
}

/**
 * The pairing screen: Google first with the token form behind a disclosure, or the token form alone, with the server's
 * reason above it when Google is set up but cannot be used yet. Unknown (the server did not answer) is today's screen.
 */
export type PairingVariant = { kind: 'google' } | { kind: 'token'; note: string | null };

export function pairingVariant(availability: SignInAvailability | null): PairingVariant {
  if (availability?.available) return { kind: 'google' };
  return { kind: 'token', note: availability?.configured ? availability.reason : null };
}

const SETUP_STEPS = ['You', 'Workspace', 'Harnesses', 'Channel', 'Done'] as const;
export type OnboardingStep = 'Sign in' | (typeof SETUP_STEPS)[number];

export const onboardingSteps = (withSignIn: boolean): readonly OnboardingStep[] => (withSignIn ? ['Sign in', ...SETUP_STEPS] : SETUP_STEPS);

/** The first onboarding step: offer Google, or show who this browser is already signed in as. */
export type SignInStep = { kind: 'offer' } | { kind: 'signed-in'; user: SignedInUser };

/** Null: no such step. A paired browser gets one only when Google can be used; a signed-in one always. */
export function signInStep(auth: AuthState, availability: SignInAvailability | null): SignInStep | null {
  if (auth.via === 'session') return { kind: 'signed-in', user: auth.user };
  return availability?.available ? { kind: 'offer' } : null;
}

/** Settings > Account. */
export type AccountView = {
  identity: { kind: 'session'; email: string; device: string } | { kind: 'token' };
  /** Show the Google button. */
  canSignIn: boolean;
  /** Why not, as a muted line. */
  note: string | null;
  /** Who may sign in, as a muted line. Null when Google is not set up, which Settings says nothing about. */
  allowed: string | null;
};

const NOBODY_YET = 'Nobody has signed in yet. The first address to sign in is the one Omni allows.';

function allowedText({ allowedEmails, allowedHd }: AuthState['google']) {
  const who = [...allowedEmails, ...(allowedHd ? [`anyone at ${allowedHd}`] : [])];
  return who.length ? `Who may sign in: ${who.join(', ')}.` : NOBODY_YET;
}

export function accountView(auth: AuthState, availability: SignInAvailability): AccountView {
  const identity: AccountView['identity'] = auth.via === 'session' ? { kind: 'session', email: auth.user.email, device: auth.device.name } : { kind: 'token' };
  if (!auth.google.loopback && !auth.google.broker) return { identity, canSignIn: false, note: null, allowed: null };
  const token = auth.via === 'token';
  return {
    identity,
    canSignIn: token && availability.available,
    note: token && !availability.available ? availability.reason : null,
    allowed: allowedText(auth.google),
  };
}
