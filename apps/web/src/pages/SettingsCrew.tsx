import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  blankCrewDraft,
  CHANGED_CHARTER_ACTIONS,
  crewChips,
  crewDraftOf,
  crewDraftProblem,
  crewIdFrom,
  crewMarkdownOf,
  crewRunLine,
  crewSaveBody,
  lineDiff,
  type CrewDetailView,
  type CrewDraft,
} from '@omni/shared/crew-settings.ts';
import { api, errorText, useApi, type CrewRole, type HarnessWithRunning } from '../api.ts';
import { AvatarColorPicker } from '../components/AvatarColorPicker.tsx';
import { CrewAvatar } from '../components/CrewAvatar.tsx';
import { Button, Chip, ErrorNote, Icon, InlineConfirm, Label, Loading, Modal, ModalFooter, Picker, Segmented, Toggle, type PickerOption } from '../components/ui.tsx';
import { useApp } from '../store.tsx';
import { IconPicker, RunDefaultsField } from './ChannelSettings.tsx';
import { Card, LockNote } from './settings-parts.tsx';

// Settings > Crew: every crew role this machine has, hidden ones included, and an editor for each (plan slice S3,
// docs/plans/2026-11-18-user-defined-crew.md). Saves go to /api/crew (apps/server/crew-api.ts): a role of your own is
// its whole file in data/crew/, an edit of a built-in is an overlay that adds to its charter or replaces it. The same
// page is the phone's Settings section and the desktop app's.

type CrewDetail = CrewDetailView<CrewRole>;

export function CrewSection() {
  const { subscribe } = useApp();
  const roles = useApi<CrewRole[]>('/crew?all=1');
  const harnesses = useApi<HarnessWithRunning[]>('/harnesses');
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const reload = roles.reload;
  // A save here, by the Conductor or on another machine.
  useEffect(() => subscribe((e) => (e.type === 'crew' || e.type === 'reconnect') && reload()), [subscribe, reload]);

  const names = {
    harness: (id: string) => harnesses.data?.find((h) => h.id === id)?.name,
    model: (h: string, id: string) => harnesses.data?.find((x) => x.id === h)?.models.find((m) => m.id === id)?.label,
  };

  return (
    <>
      <Card
        entry="crew-roles"
        title="Crew roles"
        subtitle="A thread started as a role runs with its charter. The Conductor hands work to the ones it may delegate to."
        actions={
          <Button size="sm" icon="plus" onClick={() => setEditing({ id: null })}>
            New role
          </Button>
        }
      >
        {roles.error ? (
          <ErrorNote onRetry={roles.reload}>{roles.error}</ErrorNote>
        ) : !roles.data ? (
          <Loading />
        ) : (
          <ul className="-mx-1 divide-y divide-line" aria-label="Crew roles">
            {roles.data.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setEditing({ id: r.id })} className="hov group flex w-full min-w-0 items-start gap-3 rounded-[14px] px-1 py-2.5 text-left [--hov:var(--surface-2)]">
                  <span className={r.hidden ? 'opacity-50' : undefined}>
                    <CrewAvatar role={r} size={30} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={`truncate text-[13px] font-medium ${r.hidden ? 'text-fg-3' : ''}`}>{r.name}</span>
                      <RoleChips role={r} />
                    </span>
                    {r.description && <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-fg-3">{r.description}</span>}
                    <span className="mt-0.5 block truncate text-[12px] text-fg-3">
                      {crewRunLine(r, names)}
                      {r.channel && ` · #${r.channel}`}
                      {r.delegateOnly && ' · routes only'}
                      {r.review && ' · reviews'}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={14} className="mt-1 shrink-0 text-fg-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[12.5px] text-fg-3">Yours live in data/crew/ and sync to your other machines. Hiding a built-in is for this machine only.</p>
      </Card>
      <CrewEditor target={editing} onClose={() => setEditing(null)} onOpen={(id) => setEditing({ id })} onSaved={reload} />
    </>
  );
}

function RoleChips({ role }: { role: Pick<CrewRole, 'kind' | 'hidden' | 'builtInChanged' | 'error' | 'charterMode'> }) {
  return (
    <>
      {crewChips(role).map((c) => (
        <Chip key={c.label} tone={c.tone} title={c.title}>
          {c.label}
        </Chip>
      ))}
    </>
  );
}

type View = 'edit' | 'compare' | 'duplicate';

function CrewEditor({ target, onClose, onOpen, onSaved }: { target: { id: string | null } | null; onClose: () => void; onOpen: (id: string) => void; onSaved: () => void }) {
  const { crew } = useApp();
  const [view, setView] = useState<View>('edit');
  const id = target?.id ?? null;
  // Each role opens on its form.
  useEffect(() => setView('edit'), [id]);
  const name = id ? (crew.find((r) => r.id === id)?.name ?? id) : null;
  const title = !id ? 'New role' : view === 'compare' ? `${name} and its built-in` : view === 'duplicate' ? `Duplicate ${name}` : `Edit ${name}`;
  return (
    <Modal open={!!target} onClose={onClose} title={title} roomy>
      {target && <EditorBody key={id ?? '+new'} id={id} view={view} setView={setView} onClose={onClose} onOpen={onOpen} onSaved={onSaved} />}
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="caption mb-2">{title}</legend>
      {children}
    </fieldset>
  );
}

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

/** A power's switch. `locked`: why the built-in keeps it as it ships, shown under the hint, with the switch off limits. */
function Switch({ label, hint, checked, onChange, locked }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; locked?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-fg-2">{label}</span>
        <span className="mt-0.5 block text-[13px] leading-[18px] text-fg-3">{hint}</span>
        {locked && <LockNote>{locked}</LockNote>}
      </span>
      <Toggle checked={checked} onChange={onChange} label={label} disabled={!!locked} />
    </div>
  );
}

function EditorBody({ id, view, setView, onClose, onOpen, onSaved }: { id: string | null; view: View; setView: (v: View) => void; onClose: () => void; onOpen: (id: string) => void; onSaved: () => void }) {
  const { channels } = useApp();
  const detail = useApi<CrewDetail>(id ? `/crew/${encodeURIComponent(id)}` : null);
  const [draft, setDraft] = useState<CrewDraft | null>(id ? null : blankCrewDraft());
  const [newId, setNewId] = useState<string | null>(null);
  const [mode, setMode] = useState<'form' | 'markdown'>('form');
  const [markdown, setMarkdown] = useState(id ? '' : crewMarkdownOf(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!detail.data || draft) return;
    setDraft(crewDraftOf(detail.data));
    setMarkdown(crewMarkdownOf(detail.data));
  }, [detail.data, draft]);

  const set = <K extends keyof CrewDraft>(k: K, v: CrewDraft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const d = detail.data ?? null;
  const builtIn = !!d?.builtIn;
  const role = d?.role;
  const locked = role?.locks?.fields ?? {};
  const refusedActions = role?.locks?.actions ?? {};
  // What the role's action row offers: an edited built-in compares and resets, a built-in hides, a role of the user's own is deleted.
  const can = {
    duplicate: !refusedActions.duplicate,
    edited: builtIn && role?.kind === 'edited',
    hide: builtIn && (!!role?.hidden || !refusedActions.hide),
    delete: !builtIn,
  };
  const theId = id ?? newId ?? crewIdFrom(draft?.name ?? '');

  const channelOptions = useMemo<PickerOption<string>[]>(
    () => [
      { value: '', label: 'None', sub: 'The channel a delegation names, else Inbox', avatar: false },
      ...channels.filter((c) => !c.archived || c.id === draft?.channel).map((c) => ({ value: c.id, label: c.id === 'conductor' ? 'Conductor' : c.name, channelIcon: c.icon, avatarBg: c.avatar_bg })),
      ...(draft?.channel && !channels.some((c) => c.id === draft.channel) ? [{ value: draft.channel, label: draft.channel, sub: 'No such channel here', icon: 'alert' as const, avatar: false as const, disabled: true }] : []),
    ],
    [channels, draft?.channel],
  );

  const problem = mode === 'form' && draft ? crewDraftProblem(draft, id ? undefined : theId) : mode === 'markdown' && !markdown.trim() ? 'The file is empty.' : null;

  const act = async (fn: () => Promise<unknown>, close = true) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
      if (close) onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const save = (e?: FormEvent) => {
    e?.preventDefault();
    if (!draft || problem) return;
    const body = mode === 'markdown' ? { markdown } : crewSaveBody(draft, d);
    void act(() => (id ? api.put(`/crew/${encodeURIComponent(id)}`, body) : api.post('/crew', { id: theId, ...body })));
  };
  const path = (p = '') => `/crew/${encodeURIComponent(id ?? '')}${p}`;

  if (detail.error) return <div className="px-6 pb-6"><ErrorNote onRetry={detail.reload}>{detail.error}</ErrorNote></div>;
  if (!draft) return <div className="px-6 pb-6"><Loading /></div>;

  if (view === 'compare' && d) return <CompareView detail={d} busy={busy} error={error} onBack={() => setView('edit')} onPick={(body) => void act(() => api.put(path(), body))} />;
  if (view === 'duplicate' && d)
    return (
      <DuplicateView
        from={d.role}
        busy={busy}
        error={error}
        onBack={() => setView('edit')}
        onDuplicate={(to, name) => void act(async () => {
          await api.post(path('/duplicate'), { id: to, name });
          onOpen(to);
        }, false)}
      />
    );

  return (
    <form onSubmit={save} autoComplete="off">
      <div className="space-y-5 px-6 pb-5">
        {role && (
          <div className="flex flex-wrap items-center gap-2">
            <RoleChips role={role} />
            <span className="ml-auto min-w-0 truncate font-mono text-[11.5px] text-fg-3">data/crew/{role.id}.md</span>
          </div>
        )}
        {role && (
          <div>
            {Object.values(can).some(Boolean) && (
              <div className="flex flex-wrap gap-1.5" aria-label="Role actions">
                {can.duplicate && (
                  <Button type="button" size="sm" variant="ghost" icon="copy" onClick={() => setView('duplicate')} disabled={busy}>
                    Duplicate
                  </Button>
                )}
                {can.edited && (
                  <Button type="button" size="sm" variant="ghost" icon="diff" onClick={() => setView('compare')} disabled={busy}>
                    Compare with built-in
                  </Button>
                )}
                {can.hide && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => void act(() => api.post(path('/hidden'), { hidden: !role.hidden }), false)} disabled={busy} title={role.hidden ? 'New threads can start as it again' : 'No new thread starts as it on this machine'}>
                    {role.hidden ? 'Show' : 'Hide'}
                  </Button>
                )}
                {can.edited && (
                  <InlineConfirm label="Reset to built-in" icon="undo" confirmLabel="Reset" busyLabel="Resetting" onConfirm={() => act(() => api.post(path('/reset')))} />
                )}
                {can.delete && <InlineConfirm label="Delete" icon="trash" tone="danger" confirmLabel="Delete role" busyLabel="Deleting" onConfirm={() => act(() => api.del(path()))} />}
              </div>
            )}
            {refusedActions.duplicate && <LockNote>{refusedActions.duplicate}</LockNote>}
            {refusedActions.hide && <LockNote>{refusedActions.hide}</LockNote>}
          </div>
        )}
        {role?.builtInChanged && (
          <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-surface-2 px-3.5 py-3 text-[12.5px]">
            <span className="min-w-0 flex-1 text-fg-2">The built-in charter changed since you replaced it. You may be missing its fixes.</span>
            <Button type="button" size="sm" onClick={() => setView('compare')}>
              Compare
            </Button>
          </div>
        )}

        <Segmented label="Edit as" size="sm" value={mode} onChange={setMode} options={[{ id: 'form', label: 'Form' }, { id: 'markdown', label: 'Markdown' }]} />

        {mode === 'markdown' ? (
          <Field id="crew-md" label="Markdown" hint={builtIn ? 'Your overlay on the built-in: the fields it sets and your charter text. Saved as written.' : 'The whole role: frontmatter and charter. Saved as written.'}>
            <textarea id="crew-md" className="field min-h-[360px] resize-y font-mono !text-[12.5px] leading-relaxed" value={markdown} onChange={(e) => setMarkdown(e.target.value)} spellCheck={false} />
          </Field>
        ) : (
          <>
            <Section title="Identity">
              <Field id="crew-name" label="Name">
                <input id="crew-name" className="field" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Store ops" autoFocus={!id} />
              </Field>
              {!id && (
                <Field id="crew-id" label="Id" hint="The file's name and what threads store. It never changes.">
                  <input id="crew-id" className="field font-mono !text-[13px]" value={theId} onChange={(e) => setNewId(e.target.value)} placeholder="store-ops" spellCheck={false} />
                </Field>
              )}
              <Field id="crew-desc" label="Description" hint="The Conductor reads it to pick a role for a task.">
                <textarea id="crew-desc" className="field min-h-[64px] resize-y" value={draft.description} onChange={(e) => set('description', e.target.value)} placeholder="Hands-on store work: admin, theme checks, imports." />
              </Field>
              <Field label="Avatar" hint={builtIn ? 'Without one, the built-in mark.' : 'Without one, its initials.'}>
                <IconPicker
                  inputId="crew-icon"
                  svg={false}
                  value={draft.icon}
                  name={draft.name || theId || 'Role'}
                  avatarBg={draft.bg}
                  onChange={(v) => set('icon', v)}
                  preview={<CrewAvatar role={{ id: theId, name: draft.name || theId || 'Role', avatar: draft.icon || draft.bg ? { icon: draft.icon || undefined, bg: draft.bg || undefined } : undefined }} size={36} />}
                />
              </Field>
              <Field label="Avatar background">
                <AvatarColorPicker icon={draft.icon} name={draft.name || theId || 'Role'} value={draft.bg} manual={!!draft.bg} onChange={(v) => set('bg', v)} onAuto={() => set('bg', '')} />
              </Field>
            </Section>

            <Section title="Instructions">
              {builtIn && (
                <>
                  {locked.charter_mode ? (
                    <LockNote>{locked.charter_mode}</LockNote>
                  ) : (
                    <Segmented
                      radio
                      label="Your text"
                      size="sm"
                      value={draft.charterMode}
                      onChange={(v) => set('charterMode', v)}
                      options={[
                        { id: 'append', label: 'Add to built-in' },
                        { id: 'replace', label: 'Replace' },
                      ]}
                    />
                  )}
                  <details className="rounded-[14px] bg-surface-2 px-3.5 py-2.5">
                    <summary className="cursor-pointer text-[12.5px] font-medium text-fg-2">Built-in charter</summary>
                    <pre className="mt-2 max-h-60 overflow-auto font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-fg-2">{d?.charters.builtIn}</pre>
                  </details>
                </>
              )}
              <Field
                id="crew-charter"
                label={builtIn ? (draft.charterMode === 'append' ? 'Your additions' : 'Your charter') : 'Charter'}
                hint={
                  builtIn && draft.charterMode === 'append'
                    ? 'Added after the built-in charter, so release fixes to it still reach this role. {{user}} and the other placeholders are filled in.'
                    : builtIn
                      ? 'Replaces the built-in charter. Omni says when a release changes the one you replaced.'
                      : '{{user}} and the other placeholders are filled in when a thread starts.'
                }
              >
                <textarea id="crew-charter" className="field min-h-[200px] resize-y font-mono !text-[12.5px] leading-relaxed" value={draft.charter} onChange={(e) => set('charter', e.target.value)} placeholder="You operate on client stores. Dry run first." spellCheck={false} />
              </Field>
            </Section>

            <Section title="Run">
              <Field label="Harness, model and effort" hint="Default leaves it to the channel, then Auto. A thread or delegation that names its own run wins.">
                <RunDefaultsField value={{ harness: draft.harness, model: draft.model, effort: draft.effort }} onChange={(v) => setDraft((x) => (x ? { ...x, ...v } : x))} />
              </Field>
            </Section>

            <Section title="Where">
              <Field label="Default channel" hint="Where a thread starts as this role when no channel is named.">
                <Picker size="field" label="Default channel" value={draft.channel} onChange={(v) => set('channel', v)} options={channelOptions} searchable />
              </Field>
            </Section>

            <Section title="Powers">
              <Switch label="The Conductor may delegate to it" hint="Off: the Conductor's list and the role pickers leave it out, and delegate refuses it." checked={draft.delegatable} onChange={(v) => set('delegatable', v)} locked={locked.delegatable} />
              <Switch label="Conductor tools" hint="Omni's delegate tools in its threads, so it can hand work to other roles." checked={draft.conductorTools} onChange={(v) => set('conductorTools', v)} locked={locked.mcp} />
              <Switch label="Only routes work" hint="Runs without the shell, file edits, browser and subagents: it writes briefs and delegates. Needs the conductor tools." checked={draft.delegateOnly} onChange={(v) => set('delegateOnly', v)} locked={locked.delegate_only} />
              <Switch
                label="Reviews work"
                hint="A review on a GPT model runs at high effort, and one the Conductor starts for a thread runs on the other model family from that thread's."
                checked={draft.review}
                onChange={(v) => set('review', v)}
                locked={locked.review}
              />
            </Section>
          </>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
      <ModalFooter>
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

/** A built-in's charter beside the one this role runs with, and the three ways out of a changed built-in. */
function CompareView({ detail, busy, error, onBack, onPick }: { detail: CrewDetail; busy: boolean; error: string | null; onBack: () => void; onPick: (body: object) => void }) {
  const rows = lineDiff(detail.charters.builtIn ?? '', detail.charters.effective);
  const own = detail.charters.own ?? '';
  const changes = rows.filter((r) => r.kind !== 'same').length;
  return (
    <div>
      <div className="space-y-3 px-6 pb-5">
        <p className="text-[12.5px] text-fg-3">
          {detail.role.charterMode === 'append' ? 'The built-in charter, and what your additions put after it.' : 'The built-in charter, and the one you replaced it with.'} {changes ? `${changes} changed ${changes === 1 ? 'line' : 'lines'}.` : 'No difference.'}
        </p>
        <div className="flex gap-3 text-[11.5px] text-fg-3">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--diff-del-bg)] shadow-[inset_0_0_0_1px_var(--diff-del-fg)]" />Only in the built-in</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--diff-add-bg)] shadow-[inset_0_0_0_1px_var(--diff-add-fg)]" />Only in yours</span>
        </div>
        <div className="max-h-[50vh] overflow-auto rounded-[14px] bg-surface py-2 font-mono text-[11.5px] leading-[18px]" role="table" aria-label="Built-in and your charter, line by line">
          {rows.map((r, i) => (
            <div
              key={i}
              role="row"
              className={`flex gap-2 px-3 whitespace-pre-wrap ${r.kind === 'add' ? 'bg-[var(--diff-add-bg)] text-[var(--diff-add-fg)]' : r.kind === 'del' ? 'bg-[var(--diff-del-bg)] text-[var(--diff-del-fg)]' : 'text-fg-2'}`}
            >
              <span aria-hidden="true" className="w-3 shrink-0 select-none">{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ''}</span>
              <span className="min-w-0 break-words">{r.text || ' '}</span>
            </div>
          ))}
        </div>
        {detail.role.builtInChanged && (
          <div className="space-y-2 rounded-[14px] bg-surface-2 p-3.5">
            <p className="text-[12.5px] text-fg-2">The built-in changed since you replaced it. Pick what this role runs with:</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={() => onPick(CHANGED_CHARTER_ACTIONS.keep(own))} title="Keep your charter and stop the notice until the next change">
                Keep mine
              </Button>
              <Button type="button" size="sm" disabled={busy} onClick={() => onPick(CHANGED_CHARTER_ACTIONS.addMine(own))} title="The new built-in charter, with your text added after it">
                Add mine to the new one
              </Button>
              <Button type="button" size="sm" disabled={busy} onClick={() => onPick(CHANGED_CHARTER_ACTIONS.takeBuiltIn())} title="The new built-in charter; your text goes. Your other fields stay">
                Take the new one
              </Button>
            </div>
          </div>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
      <ModalFooter>
        <Button variant="ghost" icon="chevronLeft" onClick={onBack} disabled={busy}>
          Back
        </Button>
      </ModalFooter>
    </div>
  );
}

function DuplicateView({ from, busy, error, onBack, onDuplicate }: { from: CrewRole; busy: boolean; error: string | null; onBack: () => void; onDuplicate: (id: string, name: string) => void }) {
  const [name, setName] = useState(`${from.name} copy`);
  const [id, setId] = useState<string | null>(null);
  const theId = id ?? crewIdFrom(name);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onDuplicate(theId, name.trim());
      }}
    >
      <div className="space-y-4 px-6 pb-5">
        <p className="text-[12.5px] text-fg-3">
          A new role of your own with everything {from.name} has now: its fields and its whole charter.{from.kind !== 'own' && ' Unlike the built-in, it does not change with a release.'}
        </p>
        <Field id="dup-name" label="Name">
          <input id="dup-name" className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field id="dup-id" label="Id">
          <input id="dup-id" className="field font-mono !text-[13px]" value={theId} onChange={(e) => setId(e.target.value)} spellCheck={false} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
      <ModalFooter>
        <Button variant="ghost" icon="chevronLeft" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button type="submit" variant="primary" busy={busy} disabled={!name.trim() || !theId}>
          Duplicate
        </Button>
      </ModalFooter>
    </form>
  );
}
