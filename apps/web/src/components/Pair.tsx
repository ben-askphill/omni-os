import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, UNPAIRED, errorText, finishGoogleSignIn, isPaired, pairBrowser, signInAvailability, type SignInAvailability } from '../api.ts';
import { pairingVariant, takeHashParam } from '../sign-in.ts';
import { GoogleButton } from './Account.tsx';
import { OmniMark } from './brand.tsx';
import { Button, ErrorNote, Icon, IconButton, Label, StatusDot } from './ui.tsx';

// The server takes only requests that carry this install's token (apps/server/request-guard.ts) or a Google sign-in
// session, and serves this page without either. A browser pairs once: the token, pasted here or arriving as `?pair=` in a
// link from `scripts/omni.sh --pair`, goes to POST /api/auth/pair, which answers with an HttpOnly cookie. Or it signs in
// with Google (apps/server/sign-in.ts), which sends it back as `?signin=` to finish. The page keeps nothing.

/** `#/t/abc?pair=TOKEN` gives TOKEN and leaves `#/t/abc` in the address bar and in history. */
function takeParam(name: string): string | null {
  const { value, rest } = takeHashParam(window.location.hash, name);
  if (value) history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}${rest}`);
  return value;
}

let fromLink: Promise<string | null> | null = null;
/**
 * Acts on the address once per page load (StrictMode runs effects twice): `?pair=` pairs with its token, `?signin=`
 * finishes the Google sign-in that sent the browser back. Gives the sign-in's error when it failed.
 */
const actOnLink = () =>
  (fromLink ??= (async () => {
    const token = takeParam('pair');
    const attempt = takeParam('signin');
    if (token) await pairBrowser(token).catch(() => false);
    if (!attempt) return null;
    try {
      await finishGoogleSignIn(attempt);
      return null;
    } catch (err) {
      return errorText(err);
    }
  })());

type State = 'checking' | 'paired' | 'unpaired' | 'offline';

/** Shows `children` once this browser is paired, the pairing screen until then, and again if the cookie stops working. */
export function PairGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>('checking');
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        setSignInError(await actOnLink());
        setState((await isPaired()) ? 'paired' : 'unpaired');
      } catch (err) {
        setState(err instanceof ApiError ? 'unpaired' : 'offline');
        // The server is down: look again until it answers.
        if (!(err instanceof ApiError)) retry = setTimeout(check, 3000);
      }
    };
    void check();
    const lost = () => setState('unpaired');
    window.addEventListener(UNPAIRED, lost);
    return () => {
      clearTimeout(retry);
      window.removeEventListener(UNPAIRED, lost);
    };
  }, []);

  if (state === 'checking') return null;
  if (state === 'paired') {
    // A paired browser that came back from a failed sign-in (cancelled at Google, an address not allowed) is already in.
    return (
      <>
        {children}
        {signInError && <SignInFailed message={signInError} onClose={() => setSignInError(null)} />}
      </>
    );
  }
  return (
    <PairScreen
      key={state}
      offline={state === 'offline'}
      signInError={signInError}
      onPaired={() => {
        setSignInError(null);
        setState('paired');
      }}
    />
  );
}

function SignInFailed({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[calc(88px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center md:inset-x-auto md:right-5 md:bottom-5 md:items-end">
      <div role="alert" className="toast float">
        <StatusDot status="needs" />
        <div className="min-w-0 flex-1 py-1">
          <div className="font-medium text-fg">Could not sign in</div>
          <div className="text-[12px] text-fg-3">{message}</div>
        </div>
        <IconButton icon="x" label="Dismiss" size={14} onClick={onClose} />
      </div>
    </div>
  );
}

function PairScreen({ offline, signInError, onPaired }: { offline: boolean; signInError: string | null; onPaired: () => void }) {
  const [availability, setAvailability] = useState<SignInAvailability | null | undefined>(offline ? null : undefined);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(signInError);
  const [tokenError, setTokenError] = useState<string | null>(offline ? 'Cannot reach the Omni server. Is it running?' : null);
  const [busy, setBusy] = useState(false);
  const tokenInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!offline) signInAvailability().then(setAvailability, () => setAvailability(null));
  }, [offline]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return setTokenError('Paste the token first.');
    setBusy(true);
    setTokenError(null);
    try {
      if (await pairBrowser(token)) onPaired();
      else setTokenError('That is not this Omni’s token.');
    } catch (err) {
      setTokenError(err instanceof ApiError ? errorText(err) : 'Cannot reach the Omni server. Is it running?');
    } finally {
      setBusy(false);
    }
  };

  if (availability === undefined) return null;
  const variant = pairingVariant(availability);
  const google = variant.kind === 'google';

  const tokenForm = (
    <form onSubmit={submit}>
      <Label htmlFor="pair-token" hint={<>On the Mac that runs Omni: <code className="font-mono">cat data/api-token</code>, or <code className="font-mono">scripts/omni.sh --pair</code> for a link.</>}>
        Token
      </Label>
      <input
        id="pair-token"
        ref={tokenInput}
        className="field w-full font-mono !text-[13px]"
        type="password"
        value={token}
        autoFocus={!google}
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="off"
        placeholder="64 hex characters"
        onChange={(e) => setToken(e.target.value)}
      />
      {tokenError && <ErrorNote className="mt-4">{tokenError}</ErrorNote>}
      <div className="mt-6 flex justify-end">
        <Button type="submit" variant="primary" busy={busy}>
          Pair
        </Button>
      </div>
    </form>
  );

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-bg p-4 sm:p-6">
      <section className="w-full max-w-md rounded-[28px] bg-elev p-6 shadow-[var(--shadow-menu)] sm:p-8" aria-labelledby="pair-title">
        <OmniMark size={32} state={busy ? 'thinking' : 'idle'} />
        <h1 id="pair-title" className="mt-5 text-[22px] font-semibold tracking-tight text-fg">
          {google ? 'Sign in to Omni' : 'Pair this browser'}
        </h1>
        <p className="mt-2 text-[13.5px] text-fg-2">
          {google
            ? 'Omni only answers its own clients. Sign in with Google and this browser keeps its session in a cookie its pages cannot read.'
            : 'Omni only answers its own clients. Paste the token once and this browser keeps it in a cookie its pages cannot read.'}
        </p>
        {error && <ErrorNote className="mt-5">{error}</ErrorNote>}
        {google ? (
          <>
            <GoogleButton variant="primary" size="lg" className="mt-5 w-full" onError={setError} />
            <details className="group mt-5" onToggle={(e) => e.currentTarget.open && tokenInput.current?.focus()}>
              <summary className="hov flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-full py-1 pr-3 pl-1.5 text-[13px] text-fg-2 select-none hover:text-fg [&::-webkit-details-marker]:hidden">
                <Icon name="chevronRight" size={14} className="transition-transform group-open:rotate-90" />
                Use the install token instead
              </summary>
              <div className="mt-3">{tokenForm}</div>
            </details>
          </>
        ) : (
          <div className="mt-5">
            {variant.note && <p className="mb-4 text-[12.5px] text-fg-3">{variant.note}</p>}
            {tokenForm}
          </div>
        )}
      </section>
    </div>
  );
}
