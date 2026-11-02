import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, UNPAIRED, errorText, isPaired, pairBrowser } from '../api.ts';
import { isConnectLanding, openWithConnect, redeemConnectCode, takeConnectCode, type ConnectMethod } from '../connect-key.ts';
import { OmniMark } from './brand.tsx';
import { GoogleSignIn } from './GoogleSignIn.tsx';
import { Button, ErrorNote, Label } from './ui.tsx';

// The server takes only requests that carry this install's token (apps/server/request-guard.ts), and serves this
// page without it. A browser pairs once: the token, pasted here or arriving as `?pair=` in a link from
// `scripts/omni.sh --pair`, goes to POST /api/auth/pair, which answers with an HttpOnly cookie. The page keeps nothing.
// Once an owner's Google account is linked (Settings, Sharing & access), the screen also offers Google sign-in, which gets
// this browser a session of its own, also in an HttpOnly cookie (GoogleSignIn.tsx). On this machine's Omni Connect
// address, it offers Open with Omni Connect, and #/connect lands here from the relay (connect-key.ts).

/** `#/t/abc?pair=TOKEN` gives TOKEN and leaves `#/t/abc` in the address bar and in history. */
function takePairParam(): string | null {
  const hash = window.location.hash;
  const at = hash.indexOf('?');
  if (at < 0) return null;
  const q = new URLSearchParams(hash.slice(at + 1));
  const token = q.get('pair');
  if (!token) return null;
  q.delete('pair');
  const rest = q.toString();
  history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}${hash.slice(0, at)}${rest ? `?${rest}` : ''}`);
  return token;
}

let fromLink: Promise<string | null> | null = null;
/**
 * Pairs with the token in the address, or redeems an Omni Connect code, once per page load (StrictMode runs effects
 * twice). Answers why a code did not work, if it did not.
 */
const pairFromLink = () =>
  (fromLink ??= (async () => {
    const token = takePairParam();
    if (token) await pairBrowser(token).catch(() => false);
    const code = takeConnectCode();
    if (code) return redeemConnectCode(code).then(() => null, (err: Error) => err.message);
    return null;
  })());

type State = 'checking' | 'paired' | 'unpaired' | 'offline';

/** Shows `children` once this browser is paired, the pairing screen until then, and again if the cookie stops working. */
export function PairGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>('checking');
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        setConnectError(await pairFromLink());
        const paired = await isPaired();
        // #/connect from the Omni Connect page, already in: nothing to do but go home.
        if (paired && isConnectLanding()) history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}#/`);
        setState(paired ? 'paired' : 'unpaired');
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

  if (state === 'paired') return <>{children}</>;
  if (state === 'checking') return null;
  return <PairScreen key={state} offline={state === 'offline'} connectError={connectError} onPaired={() => setState('paired')} />;
}

type Methods = { google: boolean; connect: ConnectMethod | null; checked: boolean };

/** Whether the server offers Google sign-in and Omni Connect: GET /api/auth/methods, which takes no token. */
function useMethods(offline: boolean): Methods {
  const [methods, setMethods] = useState<Methods>({ google: false, connect: null, checked: offline });
  useEffect(() => {
    if (offline) return;
    let alive = true;
    fetch('/api/auth/methods')
      .then((r) => (r.ok ? (r.json() as Promise<{ google?: boolean; connect?: ConnectMethod | null }>) : {}))
      .then((m: { google?: boolean; connect?: ConnectMethod | null }) => alive && setMethods({ google: !!m.google, connect: m.connect ?? null, checked: true }))
      .catch(() => alive && setMethods((v) => ({ ...v, checked: true })));
    return () => {
      alive = false;
    };
  }, [offline]);
  return methods;
}

function PairScreen({ offline, connectError, onPaired }: { offline: boolean; connectError: string | null; onPaired: () => void }) {
  const { google, connect, checked } = useMethods(offline);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(offline ? 'Cannot reach the Omni server. Is it running?' : connectError);
  const [opening, setOpening] = useState(false);

  const open = async (m: ConnectMethod) => {
    setOpening(true);
    setError(null);
    try {
      await openWithConnect(m);
    } catch (err) {
      setError((err as Error).message);
      setOpening(false);
    }
  };

  // #/connect, sent here from the Omni Connect page: go straight on to the relay.
  const landing = checked && !!connect && !connectError && isConnectLanding();
  useEffect(() => {
    if (landing && connect) void open(connect);
  }, [landing, connect]);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return setError('Paste the token first.');
    setBusy(true);
    setError(null);
    try {
      if (await pairBrowser(token)) onPaired();
      else setError('That is not this Omni’s token.');
    } catch (err) {
      setError(err instanceof ApiError ? errorText(err) : 'Cannot reach the Omni server. Is it running?');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-bg p-4 sm:p-6">
      <form onSubmit={submit} className="w-full max-w-md rounded-[28px] bg-elev p-6 shadow-[var(--shadow-menu)] sm:p-8" aria-labelledby="pair-title">
        <OmniMark size={32} state={busy ? 'thinking' : 'idle'} />
        <h1 id="pair-title" className="mt-5 text-[22px] font-semibold tracking-tight text-fg">
          Pair this browser
        </h1>
        <p className="mt-2 text-[13.5px] text-fg-2">
          {google
            ? 'Omni only answers its own clients. Sign in with the Google account that owns this Omni, or paste the token. Either way this browser keeps a cookie its pages cannot read.'
            : 'Omni only answers its own clients. Paste the token once and this browser keeps it in a cookie its pages cannot read.'}
        </p>
        {connect && (
          <div className="mt-5 border-b border-line pb-5">
            <Button type="button" variant="primary" icon="globe" busy={opening} onClick={() => void open(connect)}>
              Open with Omni Connect
            </Button>
            <p className="mt-2 text-[12px] text-fg-3">Uses your Omni Connect sign-in. No code to approve once you are signed in there.</p>
          </div>
        )}
        {google && (
          <div className="mt-5 border-b border-line pb-5">
            <GoogleSignIn mode="device" label="Sign in with Google" onDone={onPaired} />
          </div>
        )}
        <div className="mt-5">
          <Label htmlFor="pair-token" hint={<>On the machine that runs Omni: <code className="font-mono">cat data/api-token</code>, or <code className="font-mono">scripts/omni.sh --pair</code> for a link.</>}>
            Token
          </Label>
          <input
            id="pair-token"
            className="field w-full font-mono !text-[13px]"
            type="password"
            value={token}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            placeholder="64 hex characters"
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        {error && <ErrorNote className="mt-4">{error}</ErrorNote>}
        <div className="mt-6 flex justify-end">
          <Button type="submit" variant="primary" busy={busy}>
            Pair
          </Button>
        </div>
      </form>
    </div>
  );
}
