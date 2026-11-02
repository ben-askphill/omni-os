import { useEffect, useRef, useState } from 'react';
import type { ConnectMachine, ConnectStatus } from '@omni/server/connect/service.ts';
import { machineLabel } from '@omni/shared/handoff.ts';
import { api, errorText, useApi } from '../api.ts';
import { useHereName } from '../store.tsx';
import { Button, Chip, ErrorNote, Loading, StatusDot } from '../components/ui.tsx';
import { Card, InfoRow, SwitchRow } from './settings-parts.tsx';

// Settings, Sharing & access, Omni Connect (docs/user/omni-connect.md): turn this machine's Cloudflare tunnel on and off, see
// its address and tunnel, and open your other machines. The Mac app's Machines tab
// (apps/mac/Omni/ConnectSettingsView.swift) shows the same.

const TUNNEL: Record<ConnectStatus['tunnel']['state'], { dot: string; label: string }> = {
  off: { dot: 'idle', label: 'Off' },
  starting: { dot: 'queued', label: 'Starting' },
  connected: { dot: 'done', label: 'Connected' },
  restarting: { dot: 'needs', label: 'Restarting' },
  missing: { dot: 'needs', label: 'cloudflared missing' },
};

export function ConnectSection() {
  const res = useApi<ConnectStatus>('/connect');
  const { reload } = res;
  const hereName = useHereName();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The tunnel comes up on its own after turning on; poll so its state moves while the page is open.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && reload(), 5000);
    return () => clearInterval(t);
  }, [reload]);

  const s = res.data;
  if (res.error) return <ErrorNote onRetry={reload}>{res.error}</ErrorNote>;
  if (!s) return <Loading />;

  const toggle = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(on ? '/connect/enable' : '/connect/disable');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      reload();
    }
  };

  const tunnel = TUNNEL[s.tunnel.state] ?? { dot: 'idle', label: s.tunnel.state };
  const problem = s.tunnel.error ?? s.error;
  return (
    <Card title="Omni Connect" subtitle="Reach this Omni from any device without Tailscale, through a Cloudflare tunnel your relay sets up. Devices still sign in with Google.">
      {!s.signedIn && <p className="text-[13px] text-fg-3">Omni Connect uses the sync relay&rsquo;s sign-in. Sign in under Sync above first.</p>}
      <SwitchRow
        title={`Reach ${machineLabel(hereName)} with Omni Connect`}
        detail={s.enabled ? 'On: this Omni answers at its own address below. Turning it off deletes the tunnel.' : 'Off: only this machine, your LAN and your tailnet reach it.'}
        checked={s.enabled}
        disabled={busy || !s.signedIn}
        onChange={(v) => void toggle(v)}
      />
      {s.enabled && (
        <div className="space-y-2 text-[13px]">
          <InfoRow label="Address">
            {s.url ? (
              <a className="min-w-0 truncate font-mono text-[12.5px] text-live-text hover:underline" href={s.url} target="_blank" rel="noreferrer">
                {s.hostname}
              </a>
            ) : (
              <span className="text-fg-3">Waiting for the relay</span>
            )}
          </InfoRow>
          <InfoRow label="Tunnel">
            <StatusDot status={tunnel.dot} size={7} />
            <span className="min-w-0 truncate">{tunnel.label}</span>
          </InfoRow>
        </div>
      )}
      {s.enabled && problem && <p className="text-[12.5px] text-fg-3">{problem}</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {s.enabled && <MachineList connectPage={s.connectPage} tunnelState={s.tunnel.state} />}
    </Card>
  );
}

function MachineList({ connectPage, tunnelState }: { connectPage: string | null; tunnelState: ConnectStatus['tunnel']['state'] }) {
  const res = useApi<{ machines: ConnectMachine[] }>('/connect/machines');
  const list = res.data?.machines ?? [];
  const { reload } = res;

  // The relay asks every machine over its tunnel, so check again when this machine's tunnel changes (it is offline
  // to the relay until the tunnel is up), and every 30 seconds for the others, as the Mac app does.
  const lastTunnel = useRef(tunnelState);
  useEffect(() => {
    if (lastTunnel.current === tunnelState) return;
    lastTunnel.current = tunnelState;
    reload();
  }, [tunnelState, reload]);
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && reload(), 30_000);
    return () => clearInterval(t);
  }, [reload]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium text-fg-2">Your machines</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" icon="refresh" busy={res.loading} onClick={res.reload}>
            Check
          </Button>
          {connectPage && (
            <Button size="sm" onClick={() => window.open(connectPage, '_blank', 'noopener')}>
              Open Omni Connect
            </Button>
          )}
        </div>
      </div>
      {res.error ? (
        <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote>
      ) : !res.data ? (
        <Loading />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((m) => (
            <li key={m.id} className="flex min-w-0 items-center gap-3 py-2 text-[13px]">
              <StatusDot status={m.online ? 'done' : 'idle'} size={7} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{m.name}</span>
                  {m.current && <Chip tone="outline">Current</Chip>}
                </div>
                <div className="truncate text-[12px] text-fg-3">{m.problem ?? (m.online ? m.hostname : `Offline · ${m.hostname}`)}</div>
              </div>
              {m.online && !m.current && (
                <Button size="sm" onClick={() => window.open(`${m.url}/#/connect`, '_blank', 'noopener')}>
                  Open
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[12px] text-fg-3">On a phone, bookmark Omni Connect: sign in once there and open any machine that is on.</p>
    </div>
  );
}
