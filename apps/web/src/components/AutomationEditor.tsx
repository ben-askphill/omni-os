import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Device } from '@omni/shared/handoff.ts';
import { describeCron } from '@omni/shared/cron.ts';
import { shortPath } from '@omni/shared/short-path.ts';
import { api, errorText, useApi, type AutomationDefinition, type HarnessWithRunning, type SyncStatus } from '../api.ts';
import { blankDraft, CRON_PRESETS, draftOf, draftProblem, EVENTS, fieldsOf, isPrEvent, WEBHOOK_EVENTS, type Draft, type EventName } from '../automation-draft.ts';
import { describeEvent } from '../format.ts';
import { useApp, useHereName } from '../store.tsx';
import { Button, ErrorNote, Label, Loading, Modal, ModalFooter, Picker, Segmented, Toggle, type PickerOption } from './ui.tsx';

// The Automations page's editor: every field of an automation's YAML, and the YAML itself. Saving writes the file
// (apps/server/automation-files.ts); a shipped automation becomes your own copy in data/automations/ and Reset drops it.

const WEBHOOK_LABEL: Record<string, string> = { workflow_run: 'Workflow runs', pull_request_review: 'PR reviews' };

function Field({ id, label, hint, children }: { id?: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={id} hint={hint}>
        {label}
      </Label>
      {children}
    </div>
  );
}

function SwitchRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-fg-2">{label}</span>
        {hint && <span className="mt-0.5 block text-[13px] leading-[18px] text-fg-3">{hint}</span>}
      </span>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/** Small toggle chips for picking several of a few things: channels, webhook events. */
function ChipSet({ label, options, value, onChange }: { label: string; options: { id: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])}
            className={`hov inline-flex h-7 max-w-full items-center rounded-full px-3 text-[12.5px] [--hov:var(--surface-2)] ${on ? 'bg-fg text-bg [--hov:var(--fg-2)]' : 'bg-bg text-fg-2 shadow-[inset_0_0_0_1px_var(--line)]'}`}
          >
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface EditorTarget {
  /** Null for a new automation. */
  id: string | null;
  name?: string;
}

export function AutomationEditor({ target, onClose, onSaved }: { target: EditorTarget | null; onClose: () => void; onSaved: () => void }) {
  const open = !!target;
  const title = target?.id ? `Edit “${target.name ?? target.id}”` : 'New automation';
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {target && <EditorBody key={target.id ?? '+new'} id={target.id} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function EditorBody({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const { channels, crew } = useApp();
  const hereName = useHereName();
  const def = useApi<AutomationDefinition>(id ? `/automations/${encodeURIComponent(id)}/definition` : null);
  const harnesses = useApi<HarnessWithRunning[]>('/harnesses');
  const devices = useApi<Device[]>('/devices');
  const sync = useApi<SyncStatus>('/sync/status');
  const self = sync.data?.machineId ?? null;

  const [draft, setDraft] = useState<Draft | null>(id ? null : blankDraft(channels.find((c) => c.id === 'inbox')?.id ?? channels[0]?.id ?? 'inbox'));
  const [mode, setMode] = useState<'form' | 'yaml'>('form');
  const [yaml, setYaml] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  // A refusal shows under the last field: bring it into view, past the footer.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  // Fill the form once the file and this machine's sync id are in. A file that is not valid YAML opens on the YAML tab.
  useEffect(() => {
    if (!def.data || !sync.data || draft) return;
    setDraft(draftOf(def.data.fields, def.data.fields.machine_id, sync.data.machineId ?? null));
    setYaml(def.data.yaml);
  }, [def.data, sync.data, draft]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const channelOptions = useMemo<PickerOption<string>[]>(
    () => [
      ...channels.filter((c) => !c.archived || c.id === draft?.channel).map((c) => ({ value: c.id, label: c.name, channelIcon: c.icon, avatarBg: c.avatar_bg })),
      ...(draft?.channel && !channels.some((c) => c.id === draft.channel) ? [{ value: draft.channel, label: draft.channel, sub: 'No such channel here', icon: 'alert' as const, avatar: false as const, disabled: true }] : []),
    ],
    [channels, draft?.channel],
  );

  const machineOptions = useMemo<PickerOption<string>[]>(() => {
    const owner = sync.data?.automations;
    const defaultName = !owner || owner.isThisMac ? (hereName ?? 'this machine') : (devices.data?.find((d) => d.id === owner.owner)?.name ?? 'the machine picked above');
    const opts: PickerOption<string>[] = [
      { value: '', label: 'Same as Run automations on', sub: `Now ${defaultName}`, icon: 'layers', avatar: false },
      { value: 'here', label: hereName ?? 'This machine', sub: 'The machine you talk to', icon: 'monitor', avatar: false },
      ...(devices.data ?? []).map((d) => ({ value: d.id, label: d.name, sub: d.reachability === 'online' ? 'Online on Tailscale' : d.reachability === 'offline' ? 'Asleep or offline' : "Can't check Tailscale", icon: 'monitor' as const, avatar: false as const })),
    ];
    if (draft?.machine && !opts.some((o) => o.value === draft.machine)) opts.push({ value: draft.machine, label: draft.machine, sub: 'No synced machine has this name', icon: 'alert', avatar: false, disabled: true });
    return opts;
  }, [sync.data, devices.data, hereName, draft?.machine]);

  const harness = harnesses.data?.find((h) => h.id === draft?.harness);
  const model = harness?.models.find((m) => m.id === draft?.model);
  const harnessOptions: PickerOption<string>[] = [{ value: '', label: 'Default', sub: 'The role or channel decides', avatar: false }, ...(harnesses.data ?? []).map((h) => ({ value: h.id, label: h.name, sub: h.available ? h.plan : 'Not set up here', avatar: false as const }))];
  const modelOptions: PickerOption<string>[] = [{ value: '', label: 'Default', avatar: false }, ...(harness?.models ?? []).map((m) => ({ value: m.id, label: m.label, sub: m.note, avatar: false as const }))];
  if (draft?.model && !modelOptions.some((o) => o.value === draft.model)) modelOptions.push({ value: draft.model, label: draft.model, avatar: false });
  const effortOptions: PickerOption<string>[] = [{ value: '', label: 'Default', avatar: false }, ...(model?.efforts ?? []).map((e) => ({ value: e, label: e, avatar: false as const }))];
  if (draft?.effort && !effortOptions.some((o) => o.value === draft.effort)) effortOptions.push({ value: draft.effort, label: draft.effort, avatar: false });
  const roleOptions: PickerOption<string>[] = [{ value: '', label: 'None', avatar: false }, ...crew.map((r) => ({ value: r.id, label: r.name, sub: r.description, avatar: false as const }))];
  if (draft?.role && !roleOptions.some((o) => o.value === draft.role)) roleOptions.push({ value: draft.role, label: draft.role, avatar: false });

  const problem = mode === 'form' && draft ? draftProblem(draft) : mode === 'yaml' && !yaml.trim() ? 'The file is empty.' : null;

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!draft || problem) return;
    setBusy(true);
    setError(null);
    try {
      const path = id ? `/automations/${encodeURIComponent(id)}` : '/automations';
      const body = mode === 'yaml' && id ? { yaml } : { fields: fieldsOf(draft) };
      await (id ? api.put(path, body) : api.post(path, body));
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/automations/${encodeURIComponent(id)}/reset`);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (def.error) return <div className="px-6 pb-6"><ErrorNote onRetry={def.reload}>{def.error}</ErrorNote></div>;
  if (!draft) return <div className="px-6 pb-6"><Loading /></div>;

  const where = def.data ? shortPath(def.data.file) : null;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const cronWords = draft.cron.trim().split(/\s+/).length === 5 ? describeCron(draft.cron.trim()) : null;

  return (
    <form onSubmit={save} autoComplete="off">
      <div className="space-y-4 px-6 pb-5">
        {id && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented label="Edit as" size="sm" value={mode} onChange={setMode} options={[{ id: 'form', label: 'Form' }, { id: 'yaml', label: 'YAML' }]} />
            {where && <span className="min-w-0 truncate font-mono text-[11.5px] text-fg-3" title={def.data?.file}>{where}</span>}
          </div>
        )}
        {def.data?.shipped && !def.data.personal && (
          <p className="text-[12.5px] text-fg-3">Shipped with Omni. Saving writes your own copy to data/automations/, and updates to the shipped file stop reaching it until you reset it.</p>
        )}

        {mode === 'yaml' ? (
          <Field id="auto-yaml" label="YAML" hint="Saved as written. Unsaved changes in the form are dropped.">
            <textarea id="auto-yaml" className="field min-h-[320px] resize-y font-mono !text-[12.5px] leading-relaxed" value={yaml} onChange={(e) => setYaml(e.target.value)} spellCheck={false} />
          </Field>
        ) : (
          <>
            <Field id="auto-name" label="Name">
              <input id="auto-name" className="field" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Morning coffee" autoFocus={!id} />
            </Field>
            <SwitchRow label="On" hint={draft.enabled ? 'Runs on its schedule or events.' : 'Paused. Run now still works.'} checked={draft.enabled} onChange={(v) => set('enabled', v)} />

            <div className="space-y-3 rounded-[18px] p-4 shadow-[inset_0_0_0_1px_var(--line)]">
              <Segmented radio label="Runs" size="sm" value={draft.trigger} onChange={(v) => set('trigger', v)} options={[{ id: 'schedule', label: 'On a schedule' }, { id: 'event', label: 'On an event' }]} />
              {draft.trigger === 'schedule' ? (
                <>
                  <Field id="auto-cron" label="Cron" hint={cronWords ? cronWords : 'Minute, hour, day of month, month, day of week.'}>
                    <input id="auto-cron" className="field font-mono !text-[13px]" value={draft.cron} onChange={(e) => set('cron', e.target.value)} placeholder="0 8 * * 1-5" spellCheck={false} />
                  </Field>
                  <div className="flex flex-wrap gap-1.5">
                    {CRON_PRESETS.map((p) => (
                      <button key={p.cron} type="button" onClick={() => set('cron', p.cron)} className="hov inline-flex h-7 items-center rounded-full bg-bg px-3 text-[12px] text-fg-2 shadow-[inset_0_0_0_1px_var(--line)] [--hov:var(--surface-2)]">
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <Field id="auto-tz" label="Timezone" hint={`Leave empty for yours (${tz}).`}>
                    <input id="auto-tz" className="field font-mono !text-[13px]" value={draft.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder={tz} spellCheck={false} />
                  </Field>
                  <SwitchRow label="Catch up" hint="Run a missed slot once Omni is back, when the machine slept through it." checked={draft.catchup} onChange={(v) => set('catchup', v)} />
                </>
              ) : (
                <>
                  <Field label="Event">
                    <Picker size="field" label="Event" value={draft.event} onChange={(v) => set('event', v as EventName)} options={EVENTS.map((e) => ({ value: e, label: describeEvent(e), avatar: false }))} />
                  </Field>
                  {(isPrEvent(draft.event) || draft.event === 'github_webhook') && (
                    <Field id="auto-repo" label="Repo" hint={draft.event === 'github_webhook' ? 'The only repo whose events it takes.' : "Leave empty to watch the channel's GitHub repo."}>
                      <input id="auto-repo" className="field font-mono !text-[13px]" value={draft.repo} onChange={(e) => set('repo', e.target.value)} placeholder="owner/name" spellCheck={false} />
                    </Field>
                  )}
                  {isPrEvent(draft.event) && <SwitchRow label="Draft PRs too" checked={draft.drafts} onChange={(v) => set('drafts', v)} />}
                  {draft.event === 'github_webhook' && (
                    <Field label="GitHub events">
                      <ChipSet label="GitHub events" options={WEBHOOK_EVENTS.map((e) => ({ id: e, label: WEBHOOK_LABEL[e] }))} value={draft.webhookEvents} onChange={(v) => set('webhookEvents', v as Draft['webhookEvents'])} />
                    </Field>
                  )}
                  {(isPrEvent(draft.event) || draft.event === 'github_webhook') && (
                    <SwitchRow label="Trust anyone" hint="Off: only the repo's owners, members and collaborators fire it, never a fork. A run checks out their code with your secrets." checked={draft.trustAny} onChange={(v) => set('trustAny', v)} />
                  )}
                  {draft.event === 'artifact_published' && (
                    <>
                      <Field label="From channels" hint="None picked: pages from any channel.">
                        <ChipSet label="From channels" options={channels.filter((c) => !c.archived).map((c) => ({ id: c.id, label: `#${c.name}` }))} value={draft.channels} onChange={(v) => set('channels', v)} />
                      </Field>
                      <SwitchRow label="Republishes too" hint="Off: only a page's first publish." checked={draft.updates} onChange={(v) => set('updates', v)} />
                    </>
                  )}
                  {!isPrEvent(draft.event) && (
                    <div className="grid grid-cols-2 gap-3">
                      <Field id="auto-age" label="Max age" hint="Like 15m, 6h, 2d. Empty: a day.">
                        <input id="auto-age" className="field font-mono !text-[13px]" value={draft.maxAge} onChange={(e) => set('maxAge', e.target.value)} placeholder="1d" spellCheck={false} />
                      </Field>
                      <Field id="auto-conc" label="At once" hint="Runs going together, 1 to 8. Empty: 2.">
                        <input id="auto-conc" className="field font-mono !text-[13px]" inputMode="numeric" value={draft.concurrency} onChange={(e) => set('concurrency', e.target.value.replace(/\D/g, ''))} placeholder="2" />
                      </Field>
                    </div>
                  )}
                </>
              )}
            </div>

            <Field label="Channel" hint="Each run becomes a thread here.">
              <Picker size="field" label="Channel" value={draft.channel} onChange={(v) => set('channel', v)} options={channelOptions} searchable />
            </Field>
            <Field
              label="Machine"
              hint={self ? 'The synced machine that runs it on schedule or on events. It must be awake with Omni running. Run now uses the machine you talk to.' : 'Set up sync to pick another machine. Until then it runs here.'}
            >
              <Picker size="field" label="Machine" value={draft.machine} onChange={(v) => set('machine', v)} options={machineOptions} disabled={!self} />
            </Field>
            <Field label="Role">
              <Picker size="field" label="Role" value={draft.role} onChange={(v) => set('role', v)} options={roleOptions} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Harness">
                <Picker size="field" label="Harness" value={draft.harness} onChange={(v) => setDraft((d) => (d ? { ...d, harness: v, model: '', effort: '' } : d))} options={harnessOptions} />
              </Field>
              <Field label="Model">
                <Picker size="field" label="Model" value={draft.model} onChange={(v) => setDraft((d) => (d ? { ...d, model: v, effort: '' } : d))} options={modelOptions} disabled={!draft.harness} />
              </Field>
              <Field label="Effort">
                <Picker size="field" label="Effort" value={draft.effort} onChange={(v) => set('effort', v)} options={effortOptions} disabled={!draft.model || !model?.efforts.length} />
              </Field>
            </div>
            <Field id="auto-prompt" label="Prompt" hint="{{user}}, {{omniRoot}} and the other placeholders are filled in when it runs.">
              <textarea id="auto-prompt" className="field min-h-[160px] resize-y font-mono !text-[12.5px] leading-relaxed" value={draft.prompt} onChange={(e) => set('prompt', e.target.value)} placeholder="Run the morning-coffee skill for today." spellCheck={false} />
            </Field>
          </>
        )}
        {(error || harnesses.error) && (
          <div ref={errorRef} className="scroll-mb-24">
            <ErrorNote>{error ?? harnesses.error}</ErrorNote>
          </div>
        )}
      </div>
      <ModalFooter>
        {def.data?.shipped && def.data.personal && (
          <Button variant="ghost" icon="undo" className="mr-auto" onClick={() => void reset()} disabled={busy} title="Drop your copy and load the shipped file again">
            Reset to shipped
          </Button>
        )}
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" busy={busy} disabled={!!problem} title={problem ?? undefined}>
          {id ? 'Save' : 'Create'}
        </Button>
      </ModalFooter>
    </form>
  );
}
