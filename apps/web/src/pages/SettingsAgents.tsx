import { useState } from 'react';
import { api, errorText, harnessesPath, useApi, type Channel, type HarnessWithRunning } from '../api.ts';
import { HarnessLogo } from '../components/brand.tsx';
import { ConnectAgentSheet, RemoteMark, TestOutcome } from '../components/ConnectAgent.tsx';
import { Button, ErrorNote, Icon, InlineConfirm, Label, Loading, Modal, ModalFooter, StatusDot, Toggle } from '../components/ui.tsx';
import { customHarnessSlug } from '@omni/shared/custom-harness.ts';
import type { AgentTest } from '@omni/shared/connect-agent.ts';
import { setSettingsScope } from '../settings-scope.ts';
import { useApp } from '../store.tsx';
import { asksAuto } from '@omni/shared/thread-run.ts';
import { runBody, type ChannelRun } from '@omni/shared/channel-form.ts';
import { applyRunToChannels, bulkRunError, NO_RUN, picksRun, resetChannelsToAuto, selectedIds, toggleSelected } from '@omni/shared/channel-bulk-run.ts';
import { RunDefaultsField } from './ChannelSettings.tsx';
import { Card, LinkLine, Origin, ResetButton, ServerOptions, useScopedChannel } from './settings-parts.tsx';
import { href, navigate, useRoute } from '../router.ts';
import { ModelVisibilityCard } from './SettingsModelVisibility.tsx';

// Settings, Models: each harness with whether it can run, how to fix it, its models and its cap; which models
// the pickers list (SettingsModelVisibility.tsx); the model a new thread starts on (a channel default, else Auto); and the .env options behind them. A thread or crew
// role that picks its own model wins over the channel (apps/server/harness/resolve.ts).

/** Hermes's server is under Extras. */
export function ModelsSection() {
  const { channel } = useScopedChannel();
  return (
    <>
      <HarnessesCard channel={channel?.id} />
      <ModelVisibilityCard />
      {channel ? <ChannelModelCard channel={channel} /> : <ChannelDefaultsCard />}
      <ServerOptions section="models" entry="model-options" />
      <LinkLine href={href.settingsSection('extras', 'hermes')}>Hermes is in Extras</LinkLine>
    </>
  );
}

function HarnessesCard({ channel }: { channel?: string }) {
  const res = useApi<HarnessWithRunning[]>(harnessesPath(channel));
  // An omni://connect-agent link, or #/settings/models?connect=<link>, opens the sheet filled in.
  const route = useRoute();
  const linked = route.name === 'settings' ? route.connect : undefined;
  const [connecting, setConnecting] = useState(false);
  const [editing, setEditing] = useState<HarnessWithRunning | null>(null);
  const closeConnect = () => {
    setConnecting(false);
    if (linked) navigate(href.settingsSection('models'), { replace: true });
  };
  return (
    <Card
      entry="harnesses"
      title="Harnesses"
      subtitle="The harnesses Omni can start a thread on. Omni checks each one again when a picker opens."
      actions={
        <Button size="sm" icon="plus" onClick={() => setConnecting(true)}>
          Connect a harness
        </Button>
      }
    >
      <ConnectAgentSheet open={connecting || !!linked} initial={linked} onClose={closeConnect} onConnected={() => res.reload()} />
      {editing && <EditHarnessSheet harness={editing} onClose={() => setEditing(null)} onSaved={() => res.reload()} />}
      {res.error ? (
        <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote>
      ) : !res.data ? (
        <Loading />
      ) : (
        <ul id="setting-concurrency" className="scroll-mt-6 divide-y divide-line">
          {res.data.map((h) => {
            const def = h.models.find((m) => m.default) ?? h.models[0];
            return (
              <li key={h.id} className="flex min-w-0 items-start gap-3 py-2.5">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-bg">
                  <HarnessLogo harness={h.id} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[13px] font-medium break-words">{h.name}</span>
                    {h.remote?.custom && <RemoteMark host={h.remote.host} />}
                  </div>
                  {h.remote?.custom && (
                    <p className="mt-0.5 text-[12.5px] break-words text-fg-2">
                      Custom harness · key in <code className="text-[11.5px]">{h.remote.secret}</code>
                    </p>
                  )}
                  <p className="mt-0.5 text-[12.5px] break-words text-fg-3">
                    {h.plan} · {h.models.length} {h.models.length === 1 ? 'model' : 'models'}
                    {def && ` · default ${def.label}`} · {h.running} of {h.cap} running
                  </p>
                  {!h.available && (h.fix || h.install) && (
                    <p className="mt-1 text-[12.5px] text-fg-2">
                      {/* A command reads as code; a sentence of steps as text. */}
                      To fix: {isCommand(h.fix ?? h.install ?? '') ? <code className="text-[11.5px]">{h.fix ?? h.install}</code> : (h.fix ?? h.install)}
                    </p>
                  )}
                  {h.remote?.custom && <CustomHarnessActions harness={h} onEdit={() => setEditing(h)} onChanged={() => res.reload()} />}
                </div>
                <span className="mt-0.5 inline-flex w-[76px] shrink-0 items-center gap-1.5 text-[12.5px] whitespace-nowrap text-fg-2">
                  <StatusDot status={h.available ? 'done' : 'needs'} size={7} />
                  {h.available ? 'Ready' : 'Not ready'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** A custom harness row's Test connection, Edit and Remove. Remove revokes its key at the agent when it can. */
function CustomHarnessActions({ harness, onEdit, onChanged }: { harness: HarnessWithRunning; onEdit: () => void; onChanged: () => void }) {
  const slug = customHarnessSlug(harness.id) ?? '';
  const [test, setTest] = useState<AgentTest | null>(null);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runTest = async () => {
    setTesting(true);
    setError(null);
    setTest(null);
    try {
      setTest(await api.post<AgentTest>(`/harnesses/custom/${encodeURIComponent(slug)}/test`, {}));
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setTesting(false);
    }
  };
  const remove = async () => {
    try {
      const r = await api.del<{ revoked: boolean | null; secret: string | null }>(`/harnesses/custom/${encodeURIComponent(slug)}`);
      setNote(
        [r.revoked === true && 'Its key was revoked on its server.', r.revoked === false && 'Its server did not revoke its key: change the key there to cut it off.', r.secret && `${r.secret} was removed from Secrets.`]
          .filter(Boolean)
          .join(' ') || null,
      );
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" busy={testing} disabled={testing} onClick={() => void runTest()}>
          Test connection
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
        <InlineConfirm label="Remove" icon="trash" confirmLabel="Remove" busyLabel="Removing" tone="danger" onConfirm={remove} />
      </div>
      {test && <TestOutcome test={test} />}
      {note && <p className="text-[12.5px] text-fg-2">{note}</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

interface CustomHarnessFile {
  id: string;
  name: string;
  url: string;
  secret: string;
  bills: string;
  cap: number;
  capabilities: { steer: boolean };
}

/** Edit a custom harness's file: name, address, the secret its key is in, what it bills, its cap and Steer. */
function EditHarnessSheet({ harness, onClose, onSaved }: { harness: HarnessWithRunning; onClose: () => void; onSaved: () => void }) {
  const slug = customHarnessSlug(harness.id) ?? '';
  const files = useApi<CustomHarnessFile[]>('/harnesses/custom');
  const file = files.data?.find((f) => f.id === harness.id);
  return (
    <Modal open onClose={onClose} title={`Edit ${harness.name}`}>
      {file ? <EditHarnessForm key={file.id} slug={slug} file={file} onClose={onClose} onSaved={onSaved} /> : files.error ? <ErrorNote>{files.error}</ErrorNote> : <Loading />}
    </Modal>
  );
}

function EditHarnessForm({ slug, file, onClose, onSaved }: { slug: string; file: CustomHarnessFile; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState({ name: file.name, url: file.url, secret: file.secret, bills: file.bills, cap: file.cap, steer: file.capabilities.steer });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/harnesses/custom/${encodeURIComponent(slug)}`, { name: draft.name, url: draft.url, secret: draft.secret, bills: draft.bills, cap: draft.cap, capabilities: { steer: draft.steer } });
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
          <Label htmlFor="harness-name">Name</Label>
          <input id="harness-name" className="field w-full" value={draft.name} maxLength={80} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="harness-url" hint="https://, or http:// on the tailnet or this machine">
            Address
          </Label>
          <input id="harness-url" className="field w-full" value={draft.url} onChange={(e) => set('url', e.target.value)} spellCheck={false} />
        </div>
        <div>
          <Label htmlFor="harness-secret" hint="The secret in Settings > Secrets that holds its key">
            Key secret
          </Label>
          <input id="harness-secret" className="field w-full font-mono" value={draft.secret} onChange={(e) => set('secret', e.target.value.toUpperCase())} spellCheck={false} />
        </div>
        <div>
          <Label htmlFor="harness-bills" hint="Shown in pickers, like Claude plan">
            Bills
          </Label>
          <input id="harness-bills" className="field w-full" value={draft.bills} maxLength={160} onChange={(e) => set('bills', e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <Label htmlFor="harness-cap">Turns at once</Label>
            <input id="harness-cap" className="field w-24" type="number" min={1} max={64} value={draft.cap} onChange={(e) => set('cap', Number(e.target.value) || 1)} />
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
        <Button variant="primary" busy={busy} disabled={busy || !draft.name.trim() || !draft.url.trim() || !draft.secret.trim()} onClick={() => void save()}>
          Save
        </Button>
      </ModalFooter>
    </>
  );
}

const isCommand = (s: string) => s.length < 60 && !/[.,]\s/.test(s);

/** A channel's default as one line: Auto, or the harness and model with its effort. */
export function runDefaultLabel(c: Pick<Channel, 'default_harness' | 'default_model' | 'default_effort'>, harnesses: HarnessWithRunning[] | undefined) {
  const run = { harness: c.default_harness ?? '', model: c.default_model ?? '', effort: c.default_effort ?? '' };
  if (!(run.harness || run.model || run.effort) || asksAuto(run)) return 'Auto';
  const h = harnesses?.find((x) => x.id === (run.harness || 'claude-code'));
  const m = h?.models.find((x) => x.id === run.model);
  return [h?.name ?? run.harness, m?.label ?? (run.model || 'its default model'), run.effort].filter(Boolean).join(' · ');
}

const setsDefault = (c: Channel) => !!(c.default_harness || c.default_model || c.default_effort);

/** Every channel: what a new thread starts on in each, and which set their own (T3's "mixed"). Tick several to set them at once. */
function ChannelDefaultsCard() {
  const { channels, reloadChannels } = useApp();
  const harnesses = useApi<HarnessWithRunning[]>('/harnesses');
  const listed = channels.filter((c) => !c.archived);
  const own = listed.filter(setsDefault);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const ids = selectedIds(listed, selected);
  const title = (c: Channel) => (c.id === 'conductor' ? 'Conductor' : `#${c.name}`);
  return (
    <Card
      entry="channel-model"
      title="Default model for new threads"
      subtitle="Without one, Auto picks from the prompt. A thread or agent that picks its own model wins."
      actions={<Origin of={own.length ? 'mixed' : 'default'} label={own.length ? `${own.length} of ${listed.length} channels set one` : 'Auto everywhere'} />}
    >
      <div className="flex min-h-7 items-center gap-1 text-[12.5px] text-fg-3">
        <span className="min-w-0 flex-1">{ids.length ? `${ids.length} of ${listed.length} selected` : 'Tick channels to set them at once.'}</span>
        <Button variant="ghost" size="sm" disabled={ids.length === listed.length} onClick={() => setSelected(new Set(listed.map((c) => c.id)))}>
          Select all
        </Button>
        <Button variant="ghost" size="sm" disabled={!ids.length} onClick={() => setSelected(new Set())}>
          Select none
        </Button>
      </div>
      {ids.length > 0 && (
        <BulkRunBar
          ids={ids}
          name={(id) => title(listed.find((c) => c.id === id)!)}
          onDone={async (failed) => {
            await reloadChannels();
            setSelected(new Set(failed));
          }}
        />
      )}
      <ul className="divide-y divide-line">
        {listed.map((c) => {
          const on = selected.has(c.id);
          return (
            <li key={c.id} className="flex min-w-0 items-center gap-3">
              <SelectBox on={on} label={`Select ${title(c)}`} onClick={() => setSelected((s) => toggleSelected(s, c.id))} />
              <button type="button" onClick={() => setSettingsScope(c.id)} className="group flex min-w-0 flex-1 items-center gap-3 py-2 text-left">
                <span className="min-w-0 flex-1 truncate text-[13px] group-hover:underline group-hover:underline-offset-2">{title(c)}</span>
                <span className="min-w-0 truncate text-[12.5px] text-fg-2">{runDefaultLabel(c, harnesses.data)}</span>
                <span className="flex w-[104px] shrink-0 justify-end max-sm:hidden">
                  <Origin of={setsDefault(c) ? 'channel' : 'default'} label={setsDefault(c) ? 'Set on channel' : 'Built-in default'} />
                </span>
                <Icon name="chevronRight" size={14} className="shrink-0 text-fg-3" />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-[12.5px] text-fg-3">Pick a channel to change its default, here or in Showing above.</p>
    </Card>
  );
}

/** A row's tick box, the multi-select mark of a question card (components/thread/QuestionCard.tsx). */
function SelectBox({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={label} onClick={onClick} className="-m-1.5 grid shrink-0 place-items-center p-1.5 max-sm:-m-3 max-sm:p-3">
      <span aria-hidden="true" className={`grid h-[18px] w-[18px] place-items-center rounded-[5px] ${on ? 'bg-fg text-on-ink' : 'shadow-[inset_0_0_0_1.5px_var(--line-strong)]'}`}>
        {on && <Icon name="check" size={12} strokeWidth={2.6} />}
      </span>
    </button>
  );
}

/**
 * The picked channels' shared default: the single-channel picker (unavailable harnesses and models disabled, as there),
 * Apply to send it to all of them, and Reset to Auto to clear theirs. `onDone` gets the ids that did not save.
 */
function BulkRunBar({ ids, name, onDone }: { ids: string[]; name: (id: string) => string; onDone: (failed: string[]) => Promise<void> }) {
  const [run, setRun] = useState<ChannelRun>(NO_RUN);
  const [busy, setBusy] = useState<'apply' | 'reset' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = async (kind: 'apply' | 'reset') => {
    setBusy(kind);
    setError(null);
    const patch = (id: string, body: ReturnType<typeof runBody>) => api.patch(`/channels/${encodeURIComponent(id)}`, body);
    const r = kind === 'apply' ? await applyRunToChannels(ids, run, patch) : await resetChannelsToAuto(ids, patch);
    setError(bulkRunError(r, name));
    await onDone(r.failed.map((f) => f.id));
    if (!r.failed.length) setRun(NO_RUN);
    setBusy(null);
  };
  const n = `${ids.length} ${ids.length === 1 ? 'channel' : 'channels'}`;
  return (
    <div role="group" aria-label="Set the selected channels" className="space-y-2 rounded-[14px] bg-bg p-3">
      <div className="flex flex-wrap items-center gap-2">
        <RunDefaultsField value={run} onChange={setRun} noReset />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" busy={busy === 'reset'} disabled={!!busy} onClick={() => void send('reset')}>
            Reset to Auto
          </Button>
          <Button type="button" variant="primary" busy={busy === 'apply'} disabled={!!busy || !picksRun(run)} onClick={() => void send('apply')}>
            Apply to {n}
          </Button>
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

/** One channel in scope: its default, edited here and saved on pick. */
function ChannelModelCard({ channel }: { channel: Channel }) {
  const { reloadChannels } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = { harness: channel.default_harness ?? '', model: channel.default_model ?? '', effort: channel.default_effort ?? '' };
  const save = async (run: typeof value) => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/channels/${encodeURIComponent(channel.id)}`, runBody(run));
      await reloadChannels();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const set = setsDefault(channel);
  return (
    <Card
      entry="channel-model"
      title="Default model for new threads"
      subtitle="What a new thread in this channel starts on. A thread or agent that picks its own wins. Saved when you pick."
      actions={
        <>
          <Origin of={set ? 'channel' : 'default'} label={set ? `Set on #${channel.name}` : 'Built-in default: Auto'} />
          <ResetButton of={set ? 'channel' : 'default'} onReset={() => void save({ harness: '', model: '', effort: '' })} busy={busy} />
        </>
      }
    >
      <RunDefaultsField channel={channel.id} value={value} onChange={(v) => void save(v)} noReset />
      {error && <ErrorNote>{error}</ErrorNote>}
    </Card>
  );
}
