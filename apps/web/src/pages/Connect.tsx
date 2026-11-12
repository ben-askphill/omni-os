import { useEffect, useRef, useState } from 'react';
import type { ConnectMachine, ConnectStatus } from '@omni/server/connect/service.ts';
import { machineLabel } from '@omni/shared/handoff.ts';
import { api, errorText, useApi } from '../api.ts';
import { useHereName } from '../store.tsx';
import { Button, Chip, ErrorNote, InlineConfirm, Loading, StatusDot } from '../components/ui.tsx';
import { href } from '../router.ts';
import { Card, DangerRow, InfoList, InfoRow, LinkLine } from './settings-parts.tsx';

// Settings, Sharing & access, Omni Connect (docs/user/omni-connect.md): turn this machine's Cloudflare tunnel on, see
// its address and tunnel, and turn it off, which deletes the tunnel, behind a confirm. The machines it reaches are
// listed in Machines (ConnectMachinesCard), the one home for machine lists.

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
    <Card
      entry="connect"
      title="Omni Connect"
      subtitle="Reach this Omni from any device through a Cloudflare tunnel your relay sets up. Devices still sign in with Google."
      actions={
        s.enabled ? (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] whitespace-nowrap text-fg-2">
            <StatusDot status="done" size={7} />
            On
          </span>
        ) : (
          <Button size="sm" variant="primary" busy={busy} disabled={!s.signedIn} onClick={() => void toggle(true)}>
            Turn on
          </Button>
        )
      }
    >
      {!s.signedIn && (
        <p className="text-[13px] text-fg-3">
          Omni Connect uses the sync relay&rsquo;s sign-in.{' '}
          <a className="underline underline-offset-2 hover:text-fg" href={href.settingsSection('sync')}>
            Sign in under Sync
          </a>{' '}
          first.
        </p>
      )}
      {!s.enabled && s.signedIn && <p className="text-[13px] text-fg-3">Off: only {machineLabel(hereName)}, your LAN and your tailnet reach this Omni.</p>}
      {s.enabled && (
        <InfoList>
          <InfoRow label="Address">
            {s.url ? (
              <a className="min-w-0 truncate font-mono text-[12.5px] text-fg hover:underline" href={s.url} target="_blank" rel="noreferrer">
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
        </InfoList>
      )}
      {s.enabled && problem && <p className="text-[12.5px] text-fg-3">{problem}</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {s.enabled && (
        <DangerRow
          action={
            <InlineConfirm
              tone="danger"
              label="Turn off"
              confirmLabel="Turn off and delete"
              busyLabel="Turning off"
              disabled={busy}
              onConfirm={() => toggle(false)}
            />
          }
        >
          Turning Omni Connect off deletes the tunnel. This address stops working until you turn it on again.
        </DangerRow>
      )}
      {s.enabled && <LinkLine href={href.settingsSection('machines')}>Your machines and their addresses are in Machines</LinkLine>}
    </Card>
  );
}

/** The machines Omni Connect reaches, in Machines. Nothing while Connect is off. */
export function ConnectMachinesCard() {
  const res = useApi<ConnectStatus>('/connect');
  const { reload } = res;
  // The relay sees this machine as offline until its tunnel is up, so follow the tunnel as Sharing & access does.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && reload(), 5000);
    return () => clearInterval(t);
  }, [reload]);
  const s = res.data;
  if (!s?.enabled) return null;
  return (
    <Card
      title="Through Omni Connect"
      subtitle="Each machine with Omni Connect on, at its own address. On a phone, bookmark Omni Connect: sign in once there and open any machine that is on."
      actions={
        s.connectPage && (
          <Button size="sm" onClick={() => window.open(s.connectPage!, '_blank', 'noopener')}>
            Open Omni Connect
          </Button>
        )
      }
    >
      <MachineList tunnelState={s.tunnel.state} />
    </Card>
  );
}

function MachineList({ tunnelState }: { tunnelState: ConnectStatus['tunnel']['state'] }) {
  const res = useApi<{ machines: ConnectMachine[] }>('/connect/machines');
  const list = res.data?.machines ?? [];
  const { reload } = res;

  // The relay asks every machine over its tunnel, so check again when this machine's tunnel changes (it is offline
  // to the relay until the tunnel is up), and every 30 seconds for the others.
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
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" icon="refresh" busy={res.loading} onClick={res.reload}>
          Check
        </Button>
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
                  {m.current && <Chip tone="outline">This machine</Chip>}
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
    </div>
  );
}
