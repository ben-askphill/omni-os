import { useEffect, useState, type FormEvent } from 'react';
import type { ConnectStatus } from '@omni/server/connect/service.ts';
import { api, useApi } from '../api.ts';
import { QrCode } from '../components/QrCode.tsx';
import { Button, ErrorNote, Label, Loading, Picker } from '../components/ui.tsx';
import {
  clock,
  NEEDS_INSTALL_TOKEN,
  NO_CODE,
  pairingErrorText,
  pairingOptions,
  pairingPayload,
  parseEnteredAddress,
  parsePairingCode,
  remoteHttpsOrigin,
  secondsLeft,
  SOURCE_LABEL,
  unchecked,
} from '../pair-ios.ts';
import type { AuthAccount } from './GoogleAccount.tsx';
import { Advanced, Card, InfoRow } from './settings-parts.tsx';

// Settings, Sharing & access, Omni for iOS: a QR the iPhone app scans to pair. The addresses come from pair-ios.ts, the
// code from POST /api/auth/app-pairings. The code lives in this component only: it is not stored, logged or sent
// anywhere else, and it is dropped when it expires or the card closes. The server mints a code only for a client holding
// the install token, so a browser that signed in with Google is told where to go instead of being offered the button.
// The Mac app's card is IosPairingSettingsView.swift.

interface Issued {
  code: string;
  payload: string;
  serverUrl: string;
  expiresAt: string;
}

const host = (url: string) => url.replace(/^https:\/\//, '');

export function IosPairingSection() {
  const onRemote = !!remoteHttpsOrigin(location.origin);
  const connect = useApi<ConnectStatus>(onRemote ? null : '/connect');
  const account = useApi<AuthAccount>('/auth/account');
  const { reload } = connect;
  const [entered, setEntered] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftProblem, setDraftProblem] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const options = pairingOptions({ pageOrigin: location.origin, connect: connect.data, entered });
  const address = options.addresses.find((a) => a.url === picked) ?? options.addresses[0] ?? null;
  const url = address?.url ?? null;

  // Omni Connect is switched on in the card above and its tunnel comes up on its own: look again, as that card does,
  // so this one follows without a reload.
  useEffect(() => {
    if (onRemote) return;
    const t = setInterval(() => document.visibilityState === 'visible' && reload(), 5000);
    return () => clearInterval(t);
  }, [onRemote, reload]);

  useEffect(() => {
    if (!issued) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [issued]);

  const left = issued ? secondsLeft(issued.expiresAt, now) : 0;
  useEffect(() => {
    if (issued && left === 0) {
      setIssued(null);
      setExpired(true);
    } else if (issued && issued.serverUrl !== url) setIssued(null);
  }, [issued, left, url]);

  const issue = async () => {
    if (!url) return;
    setBusy(true);
    setError(null);
    setExpired(false);
    try {
      const code = parsePairingCode(await api.post('/auth/app-pairings'));
      if (!code) throw new Error(NO_CODE);
      setNow(Date.now());
      setIssued({ code: code.code, payload: pairingPayload(url, code.code), serverUrl: url, expiresAt: code.expiresAt });
    } catch (err) {
      setIssued(null);
      setError(pairingErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const useAddress = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseEnteredAddress(draft);
    if ('problem' in parsed) return setDraftProblem(parsed.problem);
    setDraftProblem(null);
    setEntered(parsed.url);
    setPicked(parsed.url);
    setDraft('');
  };

  const subtitle = 'Pair the iPhone app by scanning a code. The code is short-lived and holds this Omni’s address, never your token.';
  if (account.data?.via === 'session') {
    return (
      <Card title="Omni for iOS" subtitle={subtitle}>
        <p className="text-[13px] text-fg-3">{NEEDS_INSTALL_TOKEN}</p>
      </Card>
    );
  }
  const loading = (!onRemote && !connect.data && !connect.error) || (!account.data && !account.error);
  return (
    <Card title="Omni for iOS" subtitle={subtitle}>
      {loading ? (
        <Loading />
      ) : (
        <>
          {!onRemote && connect.error && !connect.data && <ErrorNote onRetry={reload}>{connect.error}</ErrorNote>}
          {address ? (
            <div className="space-y-2 text-[13px]">
              <InfoRow label="Address">
                {options.addresses.length > 1 ? (
                  <Picker
                    label="Server address"
                    value={address.url}
                    onChange={setPicked}
                    options={options.addresses.map((a) => ({ value: a.url, label: host(a.url), sub: SOURCE_LABEL[a.source], avatar: false as const }))}
                  />
                ) : (
                  <span className="min-w-0 truncate font-mono text-[12.5px]">{host(address.url)}</span>
                )}
              </InfoRow>
              {unchecked(address) && <p className="text-[12px] text-fg-3">Omni cannot check from here that your phone can reach this address. If you are unsure, open it in the phone’s browser first.</p>}
            </div>
          ) : (
            <p className="text-[13px] text-fg-3">{options.problem}</p>
          )}
          <Advanced title="Use another address" open={!address}>
            <form onSubmit={useAddress} className="space-y-2">
              <Label
                htmlFor="ios-address"
                hint={
                  <>
                    For Tailscale, run <code className="font-mono">tailscale serve --bg 4747</code> and enter your <code className="font-mono">https://&lt;mac&gt;.&lt;tailnet&gt;.ts.net</code> name.
                  </>
                }
              >
                HTTPS address
              </Label>
              <div className="flex gap-2">
                <input
                  id="ios-address"
                  className="field min-w-0 flex-1 font-mono !text-[13px]"
                  value={draft}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="off"
                  inputMode="url"
                  placeholder="https://mac.tailnet.ts.net"
                  onChange={(e) => setDraft(e.target.value)}
                />
                <Button type="submit">Use address</Button>
              </div>
              {draftProblem && <ErrorNote>{draftProblem}</ErrorNote>}
            </form>
          </Advanced>
          {address &&
            (issued ? (
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                <QrCode text={issued.payload} label="QR code for pairing the Omni iOS app" className="w-full max-w-[220px] shrink-0" />
                <div className="min-w-0 flex-1 space-y-3 text-[13px]">
                  <p className="text-fg-2">Open Omni on your iPhone and scan this code.</p>
                  <div>
                    <div className="text-[12.5px] text-fg-3">Or enter the address above and this code in the app</div>
                    <div data-manual-code className="mt-1 font-mono text-[15px] tracking-[0.02em] break-all select-all">
                      {issued.code}
                    </div>
                  </div>
                  <InfoRow label="Expires">
                    <span className="font-num">in {clock(left)}</span>
                  </InfoRow>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" busy={busy} onClick={() => void issue()}>
                      New code
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
                      Hide
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" busy={busy} onClick={() => void issue()}>
                  Show pairing code
                </Button>
                {expired && <span className="text-[12.5px] text-fg-3">The last code expired.</span>}
              </div>
            ))}
        </>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </Card>
  );
}
