import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, UNPAIRED, errorText, isPaired, pairBrowser } from '../api.ts';
import { OmniMark } from './brand.tsx';
import { Button, ErrorNote, Label } from './ui.tsx';

// The server takes only requests that carry this install's token (apps/server/request-guard.ts), and serves this
// page without it. A browser pairs once: the token, pasted here or arriving as `?pair=` in a link from
// `scripts/omni.sh --pair`, goes to POST /api/auth/pair, which answers with an HttpOnly cookie. The page keeps nothing.

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

let fromLink: Promise<void> | null = null;
/** Pairs with the token in the address, once per page load (StrictMode runs effects twice). */
const pairFromLink = () =>
  (fromLink ??= (async () => {
    const token = takePairParam();
    if (token) await pairBrowser(token).catch(() => false);
  })());

type State = 'checking' | 'paired' | 'unpaired' | 'offline';

/** Shows `children` once this browser is paired, the pairing screen until then, and again if the cookie stops working. */
export function PairGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        await pairFromLink();
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

  if (state === 'paired') return <>{children}</>;
  if (state === 'checking') return null;
  return <PairScreen key={state} offline={state === 'offline'} onPaired={() => setState('paired')} />;
}

function PairScreen({ offline, onPaired }: { offline: boolean; onPaired: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(offline ? 'Cannot reach the Omni server. Is it running?' : null);
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
          Omni only answers its own clients. Paste the token once and this browser keeps it in a cookie its pages cannot read.
        </p>
        <div className="mt-5">
          <Label htmlFor="pair-token" hint={<>On the Mac that runs Omni: <code className="font-mono">cat data/api-token</code>, or <code className="font-mono">scripts/omni.sh --pair</code> for a link.</>}>
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
