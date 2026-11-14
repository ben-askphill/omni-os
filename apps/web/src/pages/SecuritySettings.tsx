import { useState } from 'react';
import { isNewMachine, syncKeyAction } from '@omni/shared/fingerprint.ts';
import { relTime } from '@omni/shared/format.ts';
import { api, ApiError, errorText, useApi } from '../api.ts';
import { Button, Chip, ErrorNote, InlineConfirm } from '../components/ui.tsx';
import { entityLabel, fingerprintLabel, listedMcpClients, mcpClientName, ROTATE_FORBIDDEN, type McpClient, type RefusedChange, type SyncDeviceKey } from '../security-settings.ts';
import { Card, DangerRow } from './settings-parts.tsx';

// Settings cards for PRD #667: rotating the install token and the MCP clients (Sharing & access), the machines' signing
// keys and the changes this Mac refused (Sync). A server from before these routes answers their reads with 404, and those
// cards stay out; any other failed read shows in the card with Retry.

const missing = (error: unknown) => error instanceof ApiError && error.status === 404;

/** Sharing & access: a new install token, which ends every session and pairs the desktop app again. */
export function InstallTokenCard() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const rotate = async () => {
    setError(null);
    try {
      await api.post('/auth/rotate-token', {});
      setDone(true);
    } catch (e) {
      const forbidden = e instanceof ApiError && e.status === 403;
      setError(missing(e) ? 'This Omni is on a build without token rotation. Update it first.' : forbidden ? ROTATE_FORBIDDEN : errorText(e));
      throw e;
    }
  };
  return (
    <Card entry="install-token" title="Install token" subtitle="The one credential that runs agents with shell access. Rotate it if it may have leaked.">
      <DangerRow action={<InlineConfirm tone="danger" label="Rotate install token" confirmLabel="Rotate and sign out all" busyLabel="Rotating" onConfirm={rotate} />}>
        Every signed-in browser, phone and app has to pair again, this one included. The desktop app pairs itself again.
      </DangerRow>
      {done && <p className="text-[13px] text-fg-3">Rotated. Devices pair again with the new token.</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </Card>
  );
}

/** Sharing & access: the OAuth clients that reached this Omni's /mcp, to approve or remove. */
export function McpClientsCard() {
  const res = useApi<McpClient[]>('/mcp/clients');
  const [error, setError] = useState<string | null>(null);
  if (res.error && !res.data) return res.status === 404 ? null : <Card entry="mcp-clients" title="MCP clients"><ErrorNote onRetry={res.reload}>{res.error}</ErrorNote></Card>;
  const list = listedMcpClients(res.data ?? []);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      res.reload();
    } catch (e) {
      setError(errorText(e));
      throw e;
    }
  };
  return (
    <Card entry="mcp-clients" title="MCP clients" subtitle="Assistants that connected to this Omni's /mcp. Only approved ones can start threads.">
      {res.loading && !res.data ? null : list.length === 0 ? (
        <p className="text-[13px] text-fg-3">None yet. Add Omni's public MCP URL to Claude or ChatGPT and it shows here.</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((c) => (
            <li key={c.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 py-2 text-[13px]">
              <div className="min-w-0 flex-1 basis-48">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{mcpClientName(c)}</span>
                  {c.status === 'pending' && <Chip tone="needs">Pending</Chip>}
                  {c.status === 'bound' && <Chip tone="outline">Bound to this Omni</Chip>}
                </div>
                {c.status === 'bound' && <div className="text-[12px] text-fg-3">Approve also lets in tokens without an audience.</div>}
                <div className="text-[12px] text-fg-3">
                  First seen {relTime(c.firstSeen, Date.now())}, last seen {relTime(c.lastSeen, Date.now())}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {(c.status === 'pending' || c.status === 'bound') && (
                  <Button size="sm" variant="secondary" onClick={() => void act(() => api.post(`/mcp/clients/${encodeURIComponent(c.id)}/approve`, {})).catch(() => {})}>
                    Approve
                  </Button>
                )}
                <InlineConfirm tone="danger" label="Remove" confirmLabel="Remove" busyLabel="Removing" onConfirm={() => act(() => api.del(`/mcp/clients/${encodeURIComponent(c.id)}`))} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </Card>
  );
}

/**
 * Sync: each machine's signing key. Trust this machine for one new to this Mac, Confirm new key for one whose key changed
 * since it was trusted. Until then its commands, assignments, update requests and secrets wait.
 */
export function SyncKeysCard() {
  const res = useApi<SyncDeviceKey[]>('/sync/devices');
  const [error, setError] = useState<string | null>(null);
  if (res.error && !res.data) return res.status === 404 ? null : <Card entry="sync-keys" title="Signing keys"><ErrorNote onRetry={res.reload}>{res.error}</ErrorNote></Card>;
  const list = res.data ?? [];
  if (!list.length) return null;
  const confirm = async (id: string) => {
    setError(null);
    try {
      await api.post(`/sync/devices/${encodeURIComponent(id)}/confirm-key`, {});
      res.reload();
    } catch (e) {
      setError(errorText(e));
      throw e;
    }
  };
  return (
    <Card entry="sync-keys" title="Signing keys" subtitle="Each machine signs what it syncs. A change that makes this Mac act needs a machine you trust and the key this Mac pinned.">
      <ul className="divide-y divide-line">
        {list.map((d) => {
          const action = syncKeyAction(d);
          return (
            <li key={d.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 py-2 text-[13px]">
              <div className="min-w-0 flex-1 basis-48">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{d.name}</span>
                  {d.current && <Chip tone="outline">This machine</Chip>}
                  {isNewMachine(d) && <Chip tone="needs">New machine</Chip>}
                  {action === 'confirm' && <Chip tone="needs">Key changed</Chip>}
                </div>
                <div className="font-mono text-[12px] break-all text-fg-3">{fingerprintLabel(d.fingerprint)}</div>
                {action === 'confirm' && <div className="font-mono text-[12px] break-all text-fg-3">Pinned: {fingerprintLabel(d.pinnedFingerprint)}</div>}
              </div>
              {action === 'trust' && <InlineConfirm label="Trust this machine" confirmLabel={`Trust ${d.name}`} busyLabel="Trusting" onConfirm={() => confirm(d.id)} />}
              {action === 'confirm' && <InlineConfirm label="Confirm new key" confirmLabel="Trust this key" busyLabel="Confirming" onConfirm={() => confirm(d.id)} />}
            </li>
          );
        })}
      </ul>
      {list.some((d) => syncKeyAction(d)) && (
        <p className="text-[12.5px] text-fg-3">
          Trust only a machine you paired or reinstalled yourself. Compare the key with the one its own Settings shows. Until then, its commands, assignments, update requests and secrets wait.
        </p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </Card>
  );
}

/** Sync: changes this Mac refused, newest first, with the machine and the reason. */
export function RefusedChangesCard() {
  const res = useApi<RefusedChange[]>('/sync/refused?limit=50');
  if (res.error && !res.data) return res.status === 404 ? null : <Card entry="sync-refused" title="Refused changes"><ErrorNote onRetry={res.reload}>{res.error}</ErrorNote></Card>;
  const list = res.data ?? [];
  return (
    <Card entry="sync-refused" title="Refused changes" subtitle="Changes from the relay this Mac did not apply: unsigned, signed with a key it did not pin, or pointing at a folder Omni does not run in.">
      {list.length === 0 ? (
        <p className="text-[13px] text-fg-3">{res.loading && !res.data ? 'Reading' : 'None. Every synced change checked out.'}</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((r) => (
            <li key={r.id} className="min-w-0 py-2 text-[13px]">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{entityLabel(r.entity)}</span>
                <span className="min-w-0 truncate text-fg-3">from {r.machine}</span>
                <span className="ml-auto shrink-0 text-[12px] text-fg-3">{relTime(r.at, Date.now())}</span>
              </div>
              <div className="text-[12.5px] break-words text-fg-2">{r.reason}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
