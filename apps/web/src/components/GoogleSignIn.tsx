import { useEffect, useRef, useState } from 'react';
import { api, ApiError, errorText } from '../api.ts';
import { isTransientStatus, POLL_RETRIES } from '../poll-retry.ts';
import { Button, ErrorNote, LinkButton, Loader, type IconName } from './ui.tsx';

// Google sign-in through Clerk's device-code flow (apps/server/google-auth.ts). The server asks Clerk for a code;
// this shows it and links to Clerk's page, where the person signs in with Google and approves; then it polls the
// server until Clerk answers. The pairing screen uses it to sign a new device in as the owner, Settings, Sharing & access to
// link the owner's account, and Sync to sign this machine in to the relay (POST /api/sync/setup). A browser that
// signs in gets an HttpOnly cookie from the last poll and never holds the session itself.

/** What a start route answers: the code to show, where to approve it, and the flow to poll. */
export interface FlowStart {
  flow: string;
  secret: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  interval: number;
}

/** A flow that ended without signing in. */
type Ended = { state: 'refused'; error: string } | { state: 'denied' } | { state: 'expired' };

type Poll = { state: 'pending' } | { state: 'signed_in' } | { state: 'linked'; owner: { email: string | null } } | Ended;

const ENDED: Record<'denied' | 'expired', string> = {
  denied: 'Sign-in was declined on the Clerk page.',
  expired: 'The code expired before it was approved. Start again.',
};

export function GoogleSignIn({
  mode,
  label,
  onDone,
}: {
  /** `device`: sign this browser in as the owner. `link`: make the account that approves the owner. */
  mode: 'device' | 'link';
  label: string;
  onDone: (r: Extract<Poll, { state: 'signed_in' | 'linked' }>) => void;
}) {
  return (
    <DeviceCodeSignIn<Extract<Poll, { state: 'signed_in' | 'linked' }>>
      label={label}
      variant={mode === 'device' ? 'primary' : 'secondary'}
      start={() => api.post<FlowStart>(mode === 'device' ? '/auth/google/start' : '/auth/google/link', mode === 'device' ? { client: 'browser' } : {})}
      pollPath="/auth/google/poll"
      onDone={onDone}
    />
  );
}

/**
 * The device-code card any Clerk flow shows: a button that calls `start`, then the code, the link to Clerk's page,
 * and a poll of `pollPath` every interval until it answers something other than pending. A refusal, a decline or
 * an expired code shows why under the button; any other answer goes to onDone.
 */
export function DeviceCodeSignIn<R extends { state: string }>({
  label,
  start,
  pollPath,
  onDone,
  variant = 'primary',
  icon,
  disabled,
}: {
  label: string;
  start: () => Promise<FlowStart>;
  pollPath: string;
  onDone: (r: R) => void;
  variant?: 'primary' | 'secondary';
  icon?: IconName;
  disabled?: boolean;
}) {
  const [flow, setFlow] = useState<FlowStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!flow) return;
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    let misses = 0;
    const poll = async () => {
      try {
        const r = await api.post<{ state: 'pending' } | Ended | R>(pollPath, { flow: flow.flow, secret: flow.secret });
        if (!alive) return;
        misses = 0;
        if (r.state === 'pending') timer = setTimeout(poll, flow.interval * 1000);
        else {
          setFlow(null);
          const ended = r as Ended;
          if (ended.state === 'refused') setError(ended.error);
          else if (ended.state === 'denied' || ended.state === 'expired') setError(ENDED[ended.state]);
          else done.current(r as R);
        }
      } catch (err) {
        if (!alive) return;
        // A dropped connection or a proxy's 502 is not the server's answer: poll again before giving up.
        if (err instanceof ApiError && isTransientStatus(err.status) && ++misses <= POLL_RETRIES) {
          timer = setTimeout(poll, flow.interval * 1000);
          return;
        }
        setFlow(null);
        setError(errorText(err));
      }
    };
    timer = setTimeout(poll, flow.interval * 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [flow, pollPath]);

  const begin = async () => {
    setBusy(true);
    setError(null);
    try {
      setFlow(await start());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  if (flow) {
    return (
      <div className="space-y-3 rounded-[16px] bg-bg p-4">
        <p className="text-[13px] text-fg-2">Open the sign-in page, choose Google, and check it shows this code before you approve.</p>
        <div className="font-mono text-[22px] tracking-[0.12em] text-fg" aria-label="Sign-in code">
          {flow.userCode}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href={flow.verificationUriComplete ?? flow.verificationUri} target="_blank" variant="primary" icon="external">
            Open sign-in page
          </LinkButton>
          <Button variant="ghost" onClick={() => setFlow(null)}>
            Cancel
          </Button>
          <span className="ml-auto flex items-center gap-2 text-[12.5px] text-fg-3">
            <Loader size={12} /> Waiting for approval
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Button variant={variant} icon={icon} busy={busy} disabled={disabled} onClick={() => void begin()}>
        {label}
      </Button>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}
