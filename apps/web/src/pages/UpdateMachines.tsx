import { useEffect, useState } from 'react';
import { relTime } from '@omni/shared/format.ts';
import {
  fleetSummary,
  rowLabel,
  rowTone,
  skipReason,
  TRACK_LABEL,
  versionLine,
  type FleetMachine,
  type FleetRequest,
  type FleetResult,
  type FleetRowState,
  type FleetSkip,
  type FleetView,
} from '@omni/shared/update-fleet.ts';
import { api, errorText, useApi } from '../api.ts';
import { Button, Chip, ConfirmDialog, ErrorNote, Loading, StatusDot, Ticks } from '../components/ui.tsx';
import { useUpdate } from '../components/UpdateNotice.tsx';
import { desktop } from '../desktop.ts';
import { href } from '../router.ts';
import { useFeed } from '../store.tsx';
import { markUpdateStarted } from '../update-notice.ts';
import { Card } from './settings-parts.tsx';

// Settings, Machines: Update all machines. Check, Download all and Update all ask every synced machine through
// POST /api/update/fleet (apps/server/update-fleet.ts); each row is that machine's own answer, so one failing or
// offline machine never holds up the others. @omni/shared/update-fleet.ts words the states.

const SKIPPED_SHOWN_MS = 10_000;
const POLL_MS = 15_000;

/** The states that last, so a row says since when. A `sent` ask has no status change yet: it dates from the ask. */
const LASTING: ReadonlySet<FleetRowState> = new Set(['waiting', 'applying', 'restarting', 'sent']);

function since(m: FleetMachine): string | null {
  const at = m.state === 'sent' ? m.ask?.at : LASTING.has(m.state) ? m.status?.since : null;
  const t = at ? relTime(at) : '';
  if (!t) return null;
  return t === 'just now' ? t : `since ${t.replace(/^Yesterday/, 'yesterday')}`;
}

/** The note a row says about why Update leaves it out, where the state label alone would not. */
function leftOutNote(m: FleetMachine): string | null {
  return m.state === 'offline' || m.state === 'not-reporting' || m.status?.track === 'manual' ? skipReason(m, 'update') : null;
}

/** A row's own button. Retry sends the machine's last ask again, to a machine a source says is offline too. */
function rowAction(m: FleetMachine): { label: 'Retry' | 'Update'; request: FleetRequest } | null {
  if (m.state === 'failed' || m.state === 'expired' || m.state === 'offline') {
    return { label: 'Retry', request: { action: m.ask?.action ?? 'update', machines: [m.id], force: true } };
  }
  if ((m.state === 'ready' || m.state === 'available') && skipReason(m, 'update') === null) {
    return { label: 'Update', request: { action: 'update', machines: [m.id] } };
  }
  return null;
}

const machineCount = (n: number) => `${n} ${n === 1 ? 'machine' : 'machines'}`;

export function UpdateMachinesCard() {
  const res = useApi<FleetView>('/update/fleet');
  const { data, reload, setData } = res;
  const here = useUpdate();
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<FleetSkip[]>([]);
  const [confirming, setConfirming] = useState(false);

  // The server publishes `update` whenever any machine's update moves, including one synced from another machine.
  // Reach and a remote machine's answer change without one, so poll while the page is up.
  useFeed((e) => {
    if (e.type === 'update' || e.type === 'reconnect') reload();
  });
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && reload(), POLL_MS);
    return () => clearInterval(t);
  }, [reload]);
  useEffect(() => {
    if (!skipped.length) return;
    const t = setTimeout(() => setSkipped([]), SKIPPED_SHOWN_MS);
    return () => clearTimeout(t);
  }, [skipped]);

  const rows = data?.machines ?? [];
  const asked = rows.filter((m) => skipReason(m, 'update') === null);
  const left = rows.filter((m) => skipReason(m, 'update') !== null);

  /** `key` names the button that shows the spinner. Resolves to whether the server took it. */
  const send = async (key: string, request: FleetRequest): Promise<boolean> => {
    setSending(key);
    setError(null);
    setSkipped([]);
    try {
      const result = await api.post<FleetResult>('/update/fleet', request);
      // This checkout restarts on a new build: the page loads it once the server answers on the new commit, as after
      // the sidebar's Update. The desktop app relaunches with its page.
      const self = rows.find((m) => m.current);
      const restartsHere = request.action === 'update' && self?.status?.track === 'checkout' && !result.skipped.some((s) => s.id === self.id);
      if (restartsHere && (!request.machines || request.machines.includes(self.id))) markUpdateStarted(sessionStorage, here.data?.current ?? null);
      setData(result);
      setSkipped(result.skipped);
      reload();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setSending(null);
    }
  };

  const confirm = async () => {
    if (await send('update', { action: 'update' })) setConfirming(false);
  };

  return (
    <Card
      entry="update-machines"
      title="Update all machines"
      subtitle="Download fetches the update on every machine without restarting anything. Update downloads what is missing, then restarts each machine once no turn runs there."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon="refresh" busy={sending === 'check'} disabled={!data || !!sending} onClick={() => void send('check', { action: 'check' })}>
          Check
        </Button>
        <Button size="sm" icon="download" busy={sending === 'download'} disabled={!data || !!sending} onClick={() => void send('download', { action: 'download' })}>
          Download all
        </Button>
        <Button size="sm" variant="primary" icon="arrowUp" busy={sending === 'update'} disabled={!asked.length || !!sending} onClick={() => setConfirming(true)}>
          Update all
        </Button>
      </div>

      {res.error && <ErrorNote onRetry={reload}>{res.error}</ErrorNote>}
      {error && !confirming && <ErrorNote>{error}</ErrorNote>}
      {!data ? (
        !res.error && <Loading />
      ) : (
        <div className="space-y-2">
          <p className="text-[12.5px] text-fg-2">{fleetSummary(rows)}</p>
          {skipped.length > 0 && (
            <div role="status" className="rounded-2xl bg-surface-2 px-3 py-2 text-[12.5px] text-fg-2">
              <div className="font-medium">Left out</div>
              <ul className="mt-0.5 space-y-0.5">
                {skipped.map((s) => (
                  <li key={s.id} className="break-words">
                    {s.name}. {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!data.synced && (
            <p className="text-[12.5px] text-fg-3">
              Only this machine is listed. Sync your other machines with this one and this card updates them too. Set that up in{' '}
              <a className="underline underline-offset-2" href={href.settingsSection('sync')}>
                Sync
              </a>
              .
            </p>
          )}
          <ul className="divide-y divide-line">
            {rows.map((m) => (
              <FleetRow key={m.id} m={m} sending={sending} onSend={send} />
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title={`Update ${machineCount(asked.length)}?`}
        confirmLabel={`Update ${machineCount(asked.length)}`}
        busy={sending === 'update'}
        error={error}
        onConfirm={() => void confirm()}
        onCancel={() => setConfirming(false)}
      >
        <ul className="divide-y divide-line">
          {asked.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-fg">{m.name}</div>
                {versionLine(m.status) && <div className="font-mono text-[12px] text-fg-3">{versionLine(m.status)}</div>}
              </div>
              <span className="shrink-0 text-right text-[12px] text-fg-3">{rowLabel(m)}</span>
            </li>
          ))}
        </ul>
        {left.length > 0 && (
          <div>
            <div className="text-[12.5px] font-medium text-fg-2">Left out</div>
            <ul className="mt-1 space-y-1 text-[12.5px] text-fg-3">
              {left.map((m) => (
                <li key={m.id} className="break-words">
                  <span className="text-fg-2">{m.name}.</span> {skipReason(m, 'update')}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-[12.5px] text-fg-3">
          A machine with running turns restarts once they finish.
          {asked.some((m) => m.current) &&
            (desktop?.packaged
              ? ' This machine restarts too: the app relaunches and reconnects when it is back.'
              : ' This machine restarts too: this page reconnects when it is back.')}
        </p>
      </ConfirmDialog>
    </Card>
  );
}

function FleetRow({ m, sending, onSend }: { m: FleetMachine; sending: string | null; onSend: (key: string, request: FleetRequest) => Promise<boolean> }) {
  const version = versionLine(m.status);
  const lasting = since(m);
  const note = leftOutNote(m);
  const action = rowAction(m);
  const progress = m.state === 'downloading' ? m.status?.progress : null;
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3 text-[13px]">
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot status={rowTone(m.state)} size={7} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
          <span className="shrink-0 text-right text-[12.5px] text-fg-2">{rowLabel(m)}</span>
        </div>
        {(m.current || m.status || lasting) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-[15px] text-[12px] text-fg-3">
            {m.current && <Chip tone="outline">This machine</Chip>}
            {m.status && <span>{TRACK_LABEL[m.status.track]}</span>}
            {version && <span className="font-mono">{version}</span>}
            {lasting && <span>{lasting}</span>}
          </div>
        )}
        {progress != null && <Ticks responsive value={progress / 100} count={40} height={10} className="mt-2 ml-[15px]" label={`Downloading on ${m.name}`} />}
        {m.state === 'failed' && m.status?.error && <p className="mt-1.5 pl-[15px] text-[12px] break-words text-fg-2">{m.status.error}</p>}
        {note && <p className="mt-1.5 pl-[15px] text-[12px] break-words text-fg-3">{note}</p>}
      </div>
      {/* A column of its own on a wide row, so the state labels line up whether or not a row has a button. */}
      <div className={`flex shrink-0 items-center justify-end gap-2 sm:w-[68px] max-sm:basis-full max-sm:justify-start max-sm:pl-[15px] ${action ? '' : 'max-sm:hidden'}`}>
        {action && (
          <Button size="sm" variant={action.label === 'Update' ? 'primary' : 'secondary'} busy={sending === `row:${m.id}`} disabled={!!sending} onClick={() => void onSend(`row:${m.id}`, action.request)}>
            {action.label}
          </Button>
        )}
      </div>
    </li>
  );
}
