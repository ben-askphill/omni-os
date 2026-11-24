import { useEffect, useState } from 'react';
import { KIND_LABEL, normalizeCode, type AgentTest, type FoundAgent } from '@omni/shared/connect-agent.ts';
import { serverStatus, type RemoteServer } from '@omni/shared/remote-agent.ts';
import { customHarnessSlug } from '@omni/shared/custom-harness.ts';
import { api, errorText, useApi, type CrewRole } from '../api.ts';
import { useTechnical } from '../display.ts';
import { CodeEntry, TestOutcome } from '../components/ConnectAgent.tsx';
import { Button, ErrorNote, InlineConfirm, Label, Loading, Modal, ModalFooter, StatusDot, Toggle } from '../components/ui.tsx';
import { href, navigate } from '../router.ts';
import { Card } from './settings-parts.tsx';

// A remote agent's page in Settings > Agents (ADR 0020, How it looks): its server is a detail of the agent, so the
// page shows it in a Server card, and an In threads card says what it may do with a thread's files. With Show technical
// details off, the Server card has the connection status, Test connection and Remove only (Q30). The same cards on desktop
// web, the phone layout and the desktop app.

/** The Server card: connection status, Test connection and Remove, plus address, kind, key and cap with technical details. */
export function ServerCard({ agent, onChanged }: { agent: CrewRole & { server: RemoteServer }; onChanged: () => void }) {
  const technical = useTechnical();
  const s = agent.server;
  const [test, setTest] = useState<AgentTest | null>(null);
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState(false);
  // The pairing address the sheet opened with: it stays open on Paired after the card stops offering it.
  const [pairing, setPairing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runTest = async () => {
    setTesting(true);
    setError(null);
    setTest(null);
    try {
      setTest(await api.post<AgentTest>(`/crew/${encodeURIComponent(agent.id)}/server/test`, {}));
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setTesting(false);
    }
  };
  const remove = async () => {
    try {
      await api.del(`/crew/${encodeURIComponent(agent.id)}/server`);
      onChanged();
      navigate(href.settingsSection('crew'));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const slug = customHarnessSlug(s.harness);
  return (
    <Card title="Server" subtitle={`${agent.name} runs on a server of its own, outside Omni, which Omni reaches over HTTP with its key.`}>
      <p className="flex min-w-0 items-start gap-2 text-[13px]" data-server-status>
        <StatusDot status={s.available ? 'done' : 'needs'} size={7} className="mt-1.5 shrink-0" />
        <span className="min-w-0 break-words">{serverStatus(s)}</span>
      </p>
      {technical && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12.5px]" aria-label="Server details">
          <dt className="text-fg-3">Address</dt>
          <dd className="min-w-0 break-all">{s.url || 'Not set on this machine'}</dd>
          <dt className="text-fg-3">Kind</dt>
          <dd>{KIND_LABEL[s.kind]}</dd>
          <dt className="text-fg-3">Key</dt>
          <dd className="min-w-0 break-all">
            <code className="text-[11.5px]">{s.secret || 'none'}</code> in Secrets, on each machine
          </dd>
          <dt className="text-fg-3">Turns at once</dt>
          <dd>{s.cap}</dd>
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {s.pairAt && (
          <Button size="sm" variant="primary" onClick={() => setPairing(s.pairAt ?? null)}>
            Pair this machine
          </Button>
        )}
        <Button size="sm" busy={testing} disabled={testing} onClick={() => void runTest()}>
          Test connection
        </Button>
        {technical && slug && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        {technical && s.builtIn && (
          <a className="px-2 text-[12.5px] text-fg-2 underline underline-offset-2" href={href.settingsSection('extras', 'hermes')}>
            Change the address
          </a>
        )}
        <InlineConfirm label="Remove" icon="trash" confirmLabel={`Remove ${agent.name}`} busyLabel="Removing" tone="danger" onConfirm={remove} />
      </div>
      {test && <TestOutcome test={test} />}
      {error && <ErrorNote>{error}</ErrorNote>}
      <p className="text-[12.5px] text-fg-3">
        {s.builtIn
          ? 'Remove clears its address on this machine and removes the agent. Its key stays in Secrets.'
          : 'Remove revokes its key on its server where the server can, removes the secret Omni made for it and the agent, on every machine. Its threads stay readable.'}
      </p>
      {editing && slug && <EditServerSheet slug={slug} name={agent.name} onClose={() => setEditing(false)} onSaved={onChanged} />}
      {pairing && <PairHereSheet agent={agent} url={s.url} pairAt={pairing} onClose={() => setPairing(null)} onPaired={onChanged} />}
    </Card>
  );
}

/**
 * Pair this machine: the agent's file synced here from the machine that paired it, its key did not. A code from the
 * agent's own page, redeemed by this machine's server, which keeps the key only once a test turn passed with it. The key
 * never reaches this page.
 */
function PairHereSheet({ agent, url, pairAt, onClose, onPaired }: { agent: CrewRole; url: string; pairAt: string; onClose: () => void; onPaired: () => void }) {
  // Where to get a code: the agent's Connect Omni page, as Add remote agent finds it. Without one, the code field alone.
  const [found, setFound] = useState<Pick<FoundAgent, 'codeUrl'> | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .post<FoundAgent>('/harnesses/connect/find', { url, ...(pairAt !== url && { pair: pairAt }) })
      .then((f) => alive && setFound(f))
      .catch(() => alive && setFound({}));
    return () => {
      alive = false;
    };
  }, [url, pairAt]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<AgentTest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pair = async () => {
    setBusy(true);
    setError(null);
    setTest(null);
    try {
      const r = await api.post<AgentTest>(`/crew/${encodeURIComponent(agent.id)}/server/pair`, { code });
      setTest(r);
      if (r.ok) onPaired();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Pair this machine with ${agent.name}`}>
      <div className="space-y-3 px-6 pb-5">
        <p className="text-[13px] text-fg-2">Each machine keeps its own key for {agent.name}, and this one needs a new one: pair it with a code of its own. Your other machines keep theirs.</p>
        {found ? (
          <CodeEntry found={{ name: agent.name, codeUrl: found.codeUrl }} code={code} onCode={setCode} ready={!!normalizeCode(code)} busy={busy} disabled={busy || !!test?.ok} onPair={() => void pair()} />
        ) : (
          <Loading />
        )}
        {test && <TestOutcome test={test} />}
        {test?.ok && <p className="text-[13px] text-fg-2">Paired. Threads on this machine reach {agent.name} with the new key.</p>}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
      <ModalFooter>
        <Button variant={test?.ok ? 'primary' : 'secondary'} onClick={onClose}>
          {test?.ok ? 'Done' : 'Cancel'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** The In threads card: what a remote agent may do with a thread's files and messages. */
export function InThreadsCard({ agent }: { agent: CrewRole }) {
  return (
    <Card title="In threads" subtitle="What it may do in a thread it leads or is seated in.">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
        <dt className="text-fg-3">Files</dt>
        <dd data-files-row className="min-w-0">
          Reads a thread's git-tracked files and diff in channels with Remote agents can see this channel's work on (Channel settings). Never changes them.
        </dd>
        <dt className="text-fg-3">Messages</dt>
        <dd className="min-w-0">Other agents' replies and a catch-up, in those channels. Elsewhere only the message to it.</dd>
      </dl>
      <p className="text-[12.5px] text-fg-3">
        {agent.name} talks only. To change files, seat a local agent beside it with @. In a thread {agent.name} leads, you commit their changes with Commit.
      </p>
    </Card>
  );
}

interface ServerFile {
  id: string;
  name: string;
  url: string;
  secret: string;
  bills: string;
  cap: number;
  capabilities: { steer: boolean };
}

/** Edit a connected server's file: its address, the secret its key is in, what it bills, its cap and Steer. */
function EditServerSheet({ slug, name, onClose, onSaved }: { slug: string; name: string; onClose: () => void; onSaved: () => void }) {
  const files = useApi<ServerFile[]>('/harnesses/custom');
  const file = files.data?.find((f) => f.id === `custom:${slug}`);
  return (
    <Modal open onClose={onClose} title={`${name}'s server`}>
      {file ? <EditServerForm key={file.id} slug={slug} file={file} onClose={onClose} onSaved={onSaved} /> : files.error ? <ErrorNote>{files.error}</ErrorNote> : <Loading />}
    </Modal>
  );
}

function EditServerForm({ slug, file, onClose, onSaved }: { slug: string; file: ServerFile; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState({ url: file.url, secret: file.secret, bills: file.bills, cap: file.cap, steer: file.capabilities.steer });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/harnesses/custom/${encodeURIComponent(slug)}`, { name: file.name, url: draft.url, secret: draft.secret, bills: draft.bills, cap: draft.cap, capabilities: { steer: draft.steer } });
      onSaved();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="space-y-3 px-6 pb-5">
        <div>
          <Label htmlFor="server-url" hint="https://, or http:// on the tailnet or this machine">
            Address
          </Label>
          <input id="server-url" className="field w-full" value={draft.url} onChange={(e) => set('url', e.target.value)} spellCheck={false} />
        </div>
        <div>
          <Label htmlFor="server-secret" hint="The secret in Settings > Secrets that holds its key">
            Key secret
          </Label>
          <input id="server-secret" className="field w-full font-mono" value={draft.secret} onChange={(e) => set('secret', e.target.value.toUpperCase())} spellCheck={false} />
        </div>
        <div>
          <Label htmlFor="server-bills" hint="Who its turns bill">
            Bills
          </Label>
          <input id="server-bills" className="field w-full" value={draft.bills} maxLength={160} onChange={(e) => set('bills', e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <Label htmlFor="server-cap">Turns at once</Label>
            <input id="server-cap" className="field w-24" type="number" min={1} max={64} value={draft.cap} onChange={(e) => set('cap', Number(e.target.value) || 1)} />
          </div>
          <label className="flex items-center gap-2 text-[13px] text-fg-2">
            <Toggle checked={draft.steer} onChange={(v) => set('steer', v)} label="Steer" />
            Steer a running turn
          </label>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
      <ModalFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={busy || !draft.url.trim() || !draft.secret.trim()} onClick={() => void save()}>
          Save
        </Button>
      </ModalFooter>
    </>
  );
}
