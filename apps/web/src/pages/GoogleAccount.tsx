import { useState } from 'react';
import { relTime } from '@omni/shared/format.ts';
import { api, errorText, useApi } from '../api.ts';
import { GoogleSignIn } from '../components/GoogleSignIn.tsx';
import { Button, Chip, ErrorNote, InlineConfirm } from '../components/ui.tsx';
import { Card, InfoRow } from './settings-parts.tsx';

// Settings, Sharing & access, Google sign-in: the Google account that owns this Omni and the devices that signed in with it
// (apps/server/google-auth.ts). Linking and unlinking take a device paired with the token; one that signed in with
// Google can revoke devices and sign itself out, but cannot hand the install to another account.

export interface AuthAccount {
  available: boolean;
  issuer: string | null;
  owner: { email: string | null; name: string | null; linkedAt: string } | null;
  via: 'token' | 'session' | 'none';
}

export interface SignedInDevice {
  id: string;
  name: string;
  kind: 'browser' | 'app';
  /** How it got in: Google sign-in, or a pairing code. Absent from an older server, which only had Google. */
  method?: 'google' | 'pairing';
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export function GoogleAccountSection() {
  const account = useApi<AuthAccount>('/auth/account');
  // Asked whether or not a Google account is linked: an app paired with a code is a signed-in device with no owner behind it.
  const devices = useApi<{ devices: SignedInDevice[] }>(account.data ? '/auth/devices' : null);
  const [error, setError] = useState<string | null>(null);
  const a = account.data;
  if (!a) return account.error ? <ErrorNote onRetry={account.reload}>{account.error}</ErrorNote> : null;

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      account.reload();
      devices.reload();
    } catch (err) {
      setError(errorText(err));
      throw err;
    }
  };

  const byToken = a.via === 'token';
  const list = devices.data?.devices ?? [];
  const deviceList = (a.owner || list.length > 0) && (
    <div>
      <div className="mb-2 text-[12.5px] font-medium text-fg-2">Signed-in devices</div>
      {list.length === 0 ? (
        <p className="text-[13px] text-fg-3">None yet. Open Omni on another device and choose Sign in with Google, or pair the iOS app below.</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((d) => (
            <li key={d.id} className="flex min-w-0 items-center gap-3 py-2 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{d.name}</span>
                  {d.current && <Chip tone="outline">This device</Chip>}
                </div>
                <div className="text-[12px] text-fg-3">
                  {d.kind === 'app' ? 'App' : 'Browser'}{d.method === 'pairing' ? ', paired with a code' : ''}, used {relTime(d.lastSeenAt, Date.now())}
                </div>
              </div>
              {d.current ? (
                <Button size="sm" onClick={() => void api.post('/auth/signout').then(() => location.reload(), (err) => setError(errorText(err)))}>
                  Sign out
                </Button>
              ) : (
                <InlineConfirm label="Revoke" confirmLabel="Revoke" busyLabel="Revoking" onConfirm={() => act(() => api.del(`/auth/devices/${encodeURIComponent(d.id)}`))} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  if (!a.available) {
    return (
      <Card title="Google account" subtitle="Sign in to new devices with Google instead of copying the token.">
        <p className="text-[13px] text-fg-3">Google sign-in is not set up on this Omni: its config names no Clerk OAuth app.</p>
        {deviceList}
        {error && <ErrorNote>{error}</ErrorNote>}
      </Card>
    );
  }

  return (
    <Card title="Google account" subtitle="Sign in to new devices with Google instead of copying the token. Only the account linked here gets in.">
      {a.owner ? (
        <div className="space-y-2 text-[13px]">
          <InfoRow label="Account">
            <span className="min-w-0 truncate">{a.owner.email ?? a.owner.name ?? 'Linked'}</span>
          </InfoRow>
          <InfoRow label="Linked">
            <span className="text-fg-2">{relTime(a.owner.linkedAt, Date.now())}</span>
          </InfoRow>
        </div>
      ) : byToken ? (
        <GoogleSignIn mode="link" label="Link Google account" onDone={() => void act(async () => {})} />
      ) : (
        <p className="text-[13px] text-fg-3">No account is linked. Link one from a device paired with the token.</p>
      )}

      {deviceList}

      {a.owner && byToken && (
        <div className="flex flex-wrap items-center gap-3">
          <InlineConfirm label="Unlink account" confirmLabel="Unlink and sign out all" busyLabel="Unlinking" onConfirm={() => act(() => api.del('/auth/google'))} />
          <span className="text-[12px] text-fg-3">Every device signed in with Google loses access. Devices paired with the token or a code keep it.</span>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </Card>
  );
}
