import { useEffect, useState, type ReactNode } from 'react';
import { machineLabel } from '@omni/shared/handoff.ts';
import { relTime } from '@omni/shared/format.ts';
import { api, errorText, useApi, type SyncSignedIn, type SyncStatus } from '../api.ts';
import { DeviceCodeSignIn, type FlowStart } from '../components/GoogleSignIn.tsx';
import { Button, CopyButton, ErrorNote, Icon, InlineConfirm, Label, Loading, StatusDot } from '../components/ui.tsx';
import { plural } from '../format.ts';
import { useHereName, useSecretStoreLabel } from '../store.tsx';

// Settings, Sync: sign in to the Cloudflare relay with Google (through Clerk), see what is waiting, sync now, pause and sign out. The
// path map sits under Machines' Advanced.

type Status = SyncStatus;

/** One word for where sync stands, and the dot that goes with it. */
function stateOf(s: Status): { label: string; dot: string } {
  if (!s.enabled) return { label: 'Paused', dot: 'idle' };
  if (s.running) return { label: 'Syncing', dot: 'running' };
  if (s.lastError) return { label: 'Failing', dot: 'needs' };
  if (!s.lastSyncAt) return { label: 'Starting', dot: 'queued' };
  return { label: s.pending ? 'Waiting to push' : 'Up to date', dot: 'done' };
}

export function SyncSection() {
  const res = useApi<Status>('/sync/status');
  const { reload } = res;
  const store = useSecretStoreLabel();

  // The worker runs on its own; poll so the numbers move while the page is open.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && reload(), 5000);
    return () => clearInterval(t);
  }, [reload]);

  const s = res.data;
  return (
    <>
      <div className="flex gap-3 rounded-[20px] bg-surface p-4 text-[12.5px] leading-relaxed text-fg-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg text-fg-3">
          <Icon name="refresh" size={15} />
        </span>
        <div>
          Channels, threads, transcripts, artifacts, automation runs and settings go through an append-only change log. Each machine keeps its own database; your own
          Cloudflare relay (a Worker) only carries the changes. Secrets, browser profiles, worktrees and logs never leave this machine. You sign in with the Google
          account linked above, and the relay URL and this machine&rsquo;s relay token live in {store}.
        </div>
      </div>

      {res.error ? (
        <ErrorNote onRetry={reload}>{res.error}</ErrorNote>
      ) : !s ? (
        <Loading />
      ) : (
        <>
          {s.configured && <StatusCard s={s} onChange={reload} />}
          {(!s.configured || s.signedOut) && <SignInForm again={s.configured} legacy={s.legacyRelay} onDone={reload} />}
        </>
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-3 px-2.5">
      <span className="w-28 shrink-0 text-[12.5px] text-fg-3">{label}</span>
      <span className="min-w-0 flex-1 text-[13px]">{children}</span>
    </div>
  );
}

function StatusCard({ s, onChange }: { s: Status; onChange: () => void }) {
  const [busy, setBusy] = useState<'now' | 'pause' | 'owner' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = stateOf(s);
  const store = useSecretStoreLabel();
  const hereName = useHereName();

  const run = async (what: 'now' | 'pause' | 'owner', fn: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
      onChange();
    }
  };

  return (
    <section className="space-y-3 rounded-[24px] p-5 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-[16px]">
          <StatusDot status={state.dot} /> {state.label}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="primary" icon="refresh" size="sm" busy={busy === 'now' || s.running} disabled={!s.enabled} onClick={() => run('now', () => api.post('/sync/now'))}>
            Sync now
          </Button>
          <Button
            size="sm"
            icon={s.enabled ? 'pause' : 'play'}
            busy={busy === 'pause'}
            onClick={() => run('pause', () => api.post(s.enabled ? '/sync/disable' : '/sync/enable'))}
          >
            {s.enabled ? 'Pause' : 'Resume'}
          </Button>
        </div>
      </div>

      <div className="rounded-[20px] bg-surface p-1.5">
        <Row label="Last sync">
          <span className="font-num" title={s.lastSyncAt ?? undefined}>{s.lastSyncAt ? relTime(s.lastSyncAt) : 'Not since the server started'}</span>
        </Row>
        {s.nextSyncAt && s.enabled && (
          <Row label="Next sync">
            <span className="font-num text-fg-2">{new Date(s.nextSyncAt).toLocaleTimeString('en-GB')}</span>
          </Row>
        )}
        <Row label="To push">
          <span className="font-num">{plural(s.pending, 'change')}</span>
          {s.held > 0 && <span className="text-fg-3"> · {s.held} held for a newer Omni</span>}
        </Row>
        {s.deferred > 0 && (
          <Row label="Waiting">
            <span className="font-num">{plural(s.deferred, 'remote change')}</span> <span className="text-fg-3">retried after each pull</span>
          </Row>
        )}
        <Row label="Sync id">
          {s.machineId ? (
            <span className="flex items-center gap-2">
              <span className="min-w-0 truncate font-mono text-[12px]">{s.machineId}</span>
              <CopyButton text={s.machineId} />
            </span>
          ) : (
            <span className="text-fg-3">Gets an id on the first sync</span>
          )}
        </Row>
        <Row label="Automations">
          {/* One Mac runs the scheduled ones (server/sync/owner.ts), so a nightly job does not run twice. Manual runs go anywhere. */}
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Scheduled ones run on {s.automations.isThisMac ? machineLabel(hereName) : 'your other machine'}</span>
            {!s.automations.isThisMac && (
              <Button variant="secondary" size="sm" icon="play" busy={busy === 'owner'} onClick={() => run('owner', () => api.post('/sync/automations-owner'))}>
                Run them here
              </Button>
            )}
          </span>
        </Row>
        <Row label="Cursor">
          <span className="font-num text-fg-2">{s.cursor}</span>
        </Row>
      </div>

      {s.lastError && !s.signedOut && (
        <ErrorNote>
          {s.lastError}
          {s.failures > 1 && <span className="text-fg-3"> ({s.failures} tries in a row)</span>}
        </ErrorNote>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-[12px] text-fg-3">Signing out removes the credentials from {store}. History stays on this machine.</span>
        <InlineConfirm label="Sign out" icon="lock" confirmLabel="Sign out" doneLabel="Signed out" busyLabel="Signing out" onConfirm={async () => {
          await api.post('/sync/disable', { forget: true });
          onChange();
        }} />
      </div>
    </section>
  );
}

function SignInForm({ again, legacy, onDone }: { again: boolean; legacy: boolean; onDone: () => void }) {
  const [url, setUrl] = useState('');

  return (
    <section className="space-y-4 rounded-[24px] p-5 shadow-[inset_0_0_0_1px_var(--line)]">
      <div>
        <h2 className="font-display text-[16px]">{again ? 'Sign in again' : 'Sign in to your relay'}</h2>
        <p className="mt-1 text-[12.5px] text-fg-3">
          {again
            ? 'The relay no longer takes this machine’s sign-in. Nothing is lost: changes wait here until you sign in.'
            : 'The address of the Worker you deployed from apps/relay. Use the same relay and Google account on every machine.'}
        </p>
      </div>
      {legacy && !again && (
        <div className="flex gap-2 rounded-2xl bg-surface p-3 text-[12.5px] leading-relaxed text-fg-2">
          <Icon name="info" size={15} className="mt-0.5 shrink-0 text-fg-3" />
          <span>Sync moved from Supabase to a Cloudflare relay. Sign in once on each machine. Its history is queued again, so nothing is lost.</span>
        </div>
      )}
      <div>
        <Label htmlFor="sync-url">Relay URL</Label>
        <input
          id="sync-url"
          className="field font-mono !text-[13px]"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://omni-relay.<you>.workers.dev"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <DeviceCodeSignIn<SyncSignedIn>
        label="Sign in with Google"
        icon="lock"
        disabled={!url.trim()}
        start={() => api.post<FlowStart>('/sync/setup', { url: url.trim() })}
        pollPath="/sync/setup/poll"
        onDone={onDone}
      />
    </section>
  );
}

type MapRow = { from: string; to: string };

/** kv sync.path_map: where another Mac's folders live on this one. Under Machines' Advanced since #405. */
export function PathMapEditor() {
  const res = useApi<{ map: Record<string, string> }>('/sync/path-map');
  const [rows, setRows] = useState<MapRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (res.data) setRows(Object.entries(res.data.map).map(([from, to]) => ({ from, to })));
  }, [res.data]);

  const edit = (i: number, patch: Partial<MapRow>) => {
    setSaved(false);
    setRows((r) => r!.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const map = Object.fromEntries(rows!.filter((r) => r.from.trim() || r.to.trim()).map((r) => [r.from.trim(), r.to.trim()]));
      const out = await api.put<{ map: Record<string, string> }>('/sync/path-map', { map });
      res.setData(out);
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3 rounded-[24px] p-5 shadow-[inset_0_0_0_1px_var(--line)]">
      <div>
        <h2 className="font-display text-[16px]">Path map</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-fg-3">
          Paths travel with your home folder as <span className="font-mono">~</span>, so the same layout needs nothing here. When the other machine keeps a folder
          elsewhere, map it: <span className="font-mono">~/work</span> to <span className="font-mono">~/code</span>. A thread whose folder is missing here opens
          read-only.
        </p>
      </div>
      {res.error ? (
        <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote>
      ) : !rows ? (
        <Loading />
      ) : (
        <>
          {rows.length > 0 && (
            <ul className="space-y-2">
              {rows.map((r, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input aria-label="Path on the other machine" className="field min-w-0 flex-1 font-mono !text-[12.5px]" value={r.from} onChange={(e) => edit(i, { from: e.target.value })} placeholder="~/work" spellCheck={false} />
                  <Icon name="arrowRight" size={14} className="shrink-0 text-fg-4" />
                  <input aria-label="Path on this machine" className="field min-w-0 flex-1 font-mono !text-[12.5px]" value={r.to} onChange={(e) => edit(i, { to: e.target.value })} placeholder="~/code" spellCheck={false} />
                  <Button variant="ghost" size="sm" icon="trash" aria-label="Remove" onClick={() => (setSaved(false), setRows(rows.filter((_, j) => j !== i)))} />
                </li>
              ))}
            </ul>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" icon="plus" onClick={() => (setSaved(false), setRows([...rows, { from: '', to: '' }]))}>
              Add mapping
            </Button>
            <Button size="sm" variant="primary" busy={saving} onClick={save}>
              Save
            </Button>
            {saved && (
              <span className="pop-in inline-flex items-center gap-1.5 text-[12.5px] text-fg-2">
                <StatusDot status="done" /> Saved
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
