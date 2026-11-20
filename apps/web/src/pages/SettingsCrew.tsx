import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
  NO_EDITS_NOTE,
  ROLE_MEMORY_CHOICES,
  type CrewDetailView,
  type CrewDraft,
} from '@omni/shared/crew-settings.ts';
import { api, errorText, useApi, type CrewRole, type HarnessWithRunning } from '../api.ts';
import { AvatarColorPicker } from '../components/AvatarColorPicker.tsx';
import { AgentAvatar } from '../components/AgentAvatar.tsx';
import { RoleMemory } from '../components/RoleMemory.tsx';
import { Button, Chip, ErrorNote, fieldHintId, Icon, IDENTIFIER, InlineConfirm, Label, Loading, Modal, ModalFooter, Picker, Segmented, Toggle, useUnsavedChanges, type PickerOption } from '../components/ui.tsx';
import { AVATAR_UPLOAD_MAX_BYTES } from '@omni/shared/agent-avatar.ts';
import { useScrollRegion } from '../components/ui/use-scroll-region.ts';
import { useApp, useIsMobile } from '../store.tsx';
import { href, navigate } from '../router.ts';
import { squareAvatar } from '../agent-avatar-upload.ts';
import { IconPicker, RunDefaultsField } from './ChannelSettings.tsx';
import { isRemoteHarnessId } from '@omni/shared/custom-harness.ts';
import { remoteRoleNote } from '@omni/shared/crew-settings.ts';
import { Card, LockNote } from './settings-parts.tsx';

// Settings > Agents: every agent this machine has, hidden ones included. Each opens as a page of its own
// (`#/settings/crew/<id>`, group threads slice 1): its avatar on top, an Avatar card that uploads an image, and the
// editor (plan slice S3, docs/plans/2026-11-18-user-defined-crew.md). New agent opens the editor in a dialog. Saves go
// to /api/crew (apps/server/crew-api.ts): a role of your own is its whole file in data/crew/, an edit of a built-in is
// an overlay that adds to its charter or replaces it. The editor's Memory tab holds the role's lessons (slice S6,
// components/RoleMemory.tsx), which save one by one. The same page is the phone's Settings section and the desktop app's.

type CrewDetail = CrewDetailView<CrewRole>;

/** The list of agents, or one agent's page when `agent` names one. */
export function CrewSection({ agent }: { agent?: string } = {}) {
  const { subscribe } = useApp();
  const roles = useApi<CrewRole[]>('/crew?all=1');
  const harnesses = useApi<HarnessWithRunning[]>('/harnesses');
  const [creating, setCreating] = useState(false);
  const reload = roles.reload;
  // A save here, by the Conductor or on another machine, or a lesson proposed or settled (the waiting counts).
  useEffect(() => subscribe((e) => (e.type === 'crew' || e.type === 'reconnect' || (e.type === 'memory' && !!e.role)) && reload()), [subscribe, reload]);

  const names = {
    harness: (id: string) => harnesses.data?.find((h) => h.id === id)?.name,
    model: (h: string, id: string) => harnesses.data?.find((x) => x.id === h)?.models.find((m) => m.id === id)?.label,
  };

  if (agent) return <AgentPage key={agent} id={agent} roles={roles.data} onSaved={reload} />;

  return (
    <>
      <Card
        entry="crew-roles"
        title="Agents"
        subtitle="A thread started as an agent runs with its charter. The Conductor hands work to the ones it may delegate to."
        actions={
          <Button size="sm" icon="plus" onClick={() => setCreating(true)}>
            New agent
          </Button>
        }
      >
        {roles.error ? (
          <ErrorNote onRetry={roles.reload}>{roles.error}</ErrorNote>
        ) : !roles.data ? (
          <Loading />
        ) : (
          <ul className="-mx-1 divide-y divide-line" aria-label="Agents">
            {roles.data.map((r) => (
              <li key={r.id}>
                <a href={href.agent(r.id)} className="hov group flex w-full min-w-0 items-start gap-3 rounded-[14px] px-1 py-2.5 text-left [--hov:var(--surface-2)]">
                  <span className={r.hidden ? 'opacity-50' : undefined}>
                    <AgentAvatar agent={r} size={30} />
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
                      {r.tools === 'no-edits' && ' · no file edits'}
                      {r.review && ' · reviews'}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={14} className="mt-1 shrink-0 text-fg-3" />
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[12.5px] text-fg-3">Yours live in data/crew/ and sync to your other machines. Hiding a built-in is for this machine only.</p>
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="New agent" roomy dismiss="confirm">
        {creating && (
          <EditorBody
            id={null}
            waiting={0}
            view="edit"
            setView={() => {}}
            onClose={() => setCreating(false)}
            onOpen={(id) => navigate(href.agent(id))}
            onSaved={reload}
          />
        )}
      </Modal>
    </>
  );
}

/**
 * One agent as a page (ADR 0019, How it looks): its avatar, name and description on top, the Avatar card, then the
 * editor. A save keeps the page open and reads the agent again; Cancel and Delete go back to the list.
 */
function AgentPage({ id, roles, onSaved }: { id: string; roles: CrewRole[] | undefined; onSaved: () => void }) {
  const { crew } = useApp();
  const phone = useIsMobile();
  const [view, setView] = useState<View>('edit');
  // Each save opens the editor again on the agent as saved.
  const [round, setRound] = useState(0);
  const listed = roles?.find((r) => r.id === id) ?? crew.find((r) => r.id === id);
  const back = () => navigate(href.settingsSection('crew'));
  const saved = () => {
    onSaved();
    setView('edit');
    setRound((n) => n + 1);
  };
  if (roles && !listed)
    return (
      <div className="space-y-3 pt-6">
        <ErrorNote>No agent "{id}" on this machine.</ErrorNote>
        <Button size="sm" icon="chevronLeft" onClick={back}>
          Agents
        </Button>
      </div>
    );
  const name = listed?.name ?? id;
  return (
    <div className="space-y-5 pt-6 pb-16 md:pt-10">
      <a href={href.settingsSection('crew')} className="inline-flex items-center gap-1 text-[12.5px] text-fg-3 hover:text-fg max-md:hidden">
        <Icon name="chevronLeft" size={12} /> Agents
      </a>
      <header className={phone ? 'flex flex-col items-center gap-2 text-center' : 'flex items-center gap-4'}>
        {listed ? <AgentAvatar agent={listed} size={phone ? 88 : 72} /> : <span className="rounded-full bg-surface-2" style={{ width: phone ? 88 : 72, height: phone ? 88 : 72 }} />}
        <div className="min-w-0">
          <h1 className={`font-display leading-tight font-semibold ${phone ? 'text-[22px]' : 'text-[26px]'}`}>{name}</h1>
          {listed?.description && <p className="mt-1 text-[13px] text-fg-3">{listed.description}</p>}
        </div>
      </header>
      {listed && <AvatarCard agent={listed} onSaved={saved} />}
      <Card title={view === 'compare' ? `${name} and its built-in` : view === 'duplicate' ? `Duplicate ${name}` : 'Agent'} subtitle={view === 'edit' ? 'Its name, charter, run defaults, powers and memory.' : undefined}>
        <EditorBody
          key={`${id}:${round}`}
          id={id}
          page
          waiting={listed?.memoryWaiting ?? 0}
          view={view}
          setView={setView}
          onClose={back}
          onOpen={(to) => navigate(href.agent(to))}
          onSaved={saved}
        />
      </Card>
    </div>
  );
}

/** Where an agent's face comes from, in a line under it. */
function avatarSource(agent: CrewRole) {
  if (agent.avatar?.image) return 'An image you uploaded. It syncs to your other machines with the agent.';
  if (agent.avatar?.icon) return 'Its icon, on its color. An uploaded image takes its place.';
  if (agent.kind !== 'own' && !agent.avatar?.bg && ['conductor', 'researcher', 'builder', 'store-ops', 'inbox'].includes(agent.id)) return 'Its built-in mark. An uploaded image takes its place.';
  return 'No image yet: its initials, on a color from its id.';
}

/**
 * The Avatar card: the agent's face, where it comes from, and Upload or Remove image. A picked file is cropped square
 * from its center and scaled to 256px here (agent-avatar-upload.ts), then saved at once (PUT /api/crew/:id/avatar).
 * The icon and color stay in the editor's form, as the look an agent shows without an image.
 */
function AvatarCard({ agent, onSaved }: { agent: CrewRole; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const put = async (image: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/crew/${encodeURIComponent(agent.id)}/avatar`, { image: await image() });
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card entry="agent-avatar" title="Avatar" subtitle={`Shown on every message ${agent.name} writes.`}>
      <div className="flex flex-wrap items-center gap-4">
        <AgentAvatar agent={agent} size={60} />
        <div className="min-w-0 flex-1 basis-48">
          <div className="text-[12.5px] text-fg-3">{avatarSource(agent)}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" icon="image" busy={busy} onClick={() => input.current?.click()}>
              {agent.avatar?.image ? 'Replace image' : 'Upload image'}
            </Button>
            {agent.avatar?.image && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void put(async () => null)}>
                Remove image
              </Button>
            )}
          </div>
          <div className="mt-1.5 text-[11.5px] text-fg-3">PNG, JPEG or WebP up to {AVATAR_UPLOAD_MAX_BYTES / 1024 / 1024} MB. Omni crops it square from the center.</div>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-label={`Upload an avatar for ${agent.name}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void put(() => squareAvatar(file));
            }}
          />
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Card>
  );
}

function RoleChips({ role }: { role: Pick<CrewRole, 'kind' | 'hidden' | 'builtInChanged' | 'error' | 'charterMode' | 'memoryWaiting'> }) {
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

/** A dialog's footer, or on the agent page a row of its own under the form. */
function Footer({ page, children }: { page?: boolean; children: ReactNode }) {
  return page ? <div className="flex items-center justify-end gap-2 border-t border-line pt-4">{children}</div> : <ModalFooter>{children}</ModalFooter>;
}

function EditorBody({
  id,
  page,
  waiting,
  view,
  setView,
  onClose,
  onOpen,
  onSaved,
}: {
  id: string | null;
  /** On the agent page, not in a dialog: a save stays (`onSaved` opens it again on the saved agent), Cancel goes back. */
  page?: boolean;
  /** Lessons its threads proposed that wait for the user: the Memory tab's count. */
  waiting: number;
  view: View;
  setView: (v: View) => void;
  onClose: () => void;
  onOpen: (id: string) => void;
  onSaved: () => void;
}) {
  const { channels } = useApp();
  const detail = useApi<CrewDetail>(id ? `/crew/${encodeURIComponent(id)}` : null);
  const [draft, setDraft] = useState<CrewDraft | null>(id ? null : blankCrewDraft());
  const [newId, setNewId] = useState<string | null>(null);
  const [mode, setMode] = useState<'form' | 'markdown'>('form');
  // The Memory tab: the role's lessons, saved one by one, beside the draft the Form and Markdown tabs share.
  const [memoryTab, setMemoryTab] = useState(false);
  const [markdown, setMarkdown] = useState(id ? '' : crewMarkdownOf(null));
  // The Markdown tab's text as it last matched the form. An edit there is read into the form on the way back.
  const [synced, setSynced] = useState(markdown);
  // The file the form was last read from, once the Markdown tab changed it, and the role it makes. A Form save then
  // lays the form's changes over that text, so an edit made there and a key the form does not show are kept. Null:
  // the saved file is the base.
  const [base, setBase] = useState<{ own: string; detail: CrewDetail } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!detail.data || draft) return;
    setDraft(crewDraftOf(detail.data));
    setMarkdown(crewMarkdownOf(detail.data));
    setSynced(crewMarkdownOf(detail.data));
  }, [detail.data, draft]);

  // The role as it opened, so a close asks first once the form or its Markdown differs.
  const snapshot = draft ? JSON.stringify([draft, markdown]) : null;
  const [pristine, setPristine] = useState<string | null>(null);
  useEffect(() => {
    if (pristine === null && snapshot !== null) setPristine(snapshot);
  }, [pristine, snapshot]);
  useUnsavedChanges(pristine !== null && snapshot !== pristine);

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

  const work = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  // On the page a save stays and reads the agent again (onSaved); a delete leaves it.
  const act = async (fn: () => Promise<unknown>, close = true, leave = false) => {
    if (!(await work(fn))) return;
    onSaved();
    if (close && (!page || leave)) onClose();
  };

  // The file a save would write, nothing written (POST /api/crew/draft): how the two tabs turn into each other.
  const drafted = (save: object, own?: string) => api.post<{ markdown: string; detail: CrewDetail }>('/crew/draft', { ...(id && { id }), ...(own !== undefined && { own }), save });

  const switchTo = (next: 'form' | 'markdown') => {
    if (next === mode || !draft || busy) return;
    void work(async () => {
      if (next === 'markdown') {
        const changes = crewSaveBody(draft, base?.detail ?? d);
        if (Object.keys(changes.fields).length || changes.charter !== undefined || changes.charter_mode) {
          const { markdown: text, detail: made } = await drafted(changes, base?.own);
          setMarkdown(text);
          setSynced(text);
          setBase({ own: text, detail: made });
        }
      } else if (markdown !== synced) {
        const { detail: made } = await drafted({ markdown });
        setDraft(crewDraftOf(made));
        setBase({ own: markdown, detail: made });
        setSynced(markdown);
      }
      setMode(next);
    });
  };

  const save = (e?: FormEvent) => {
    e?.preventDefault();
    if (!draft || problem) return;
    void act(async () => {
      const body = mode === 'markdown' ? { markdown } : base ? { markdown: (await drafted(crewSaveBody(draft, base.detail), base.own)).markdown } : crewSaveBody(draft, d);
      if (id) await api.put(`/crew/${encodeURIComponent(id)}`, body);
      else {
        await api.post('/crew', { id: theId, ...body });
        // A new agent opens on its page, where its avatar is uploaded.
        onOpen(theId);
      }
    });
  };
  const path = (p = '') => `/crew/${encodeURIComponent(id ?? '')}${p}`;

  const pad = page ? '' : 'px-6 pb-6';
  if (detail.error) return <div className={pad}><ErrorNote onRetry={detail.reload}>{detail.error}</ErrorNote></div>;
  if (!draft) return <div className={pad}><Loading /></div>;

  if (view === 'compare' && d) return <CompareView detail={d} page={page} busy={busy} error={error} onBack={() => setView('edit')} onPick={(body) => void act(() => api.put(path(), body))} />;
  if (view === 'duplicate' && d)
    return (
      <DuplicateView
        from={d.role}
        page={page}
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
      <div className={page ? 'space-y-5 pb-5' : 'space-y-5 px-6 pb-5'}>
        {role && (
          <div className="flex flex-wrap items-center gap-2">
            <RoleChips role={role} />
            <span className="ml-auto min-w-0 truncate font-mono text-[11.5px] text-fg-3">data/crew/{role.id}.md</span>
          </div>
        )}
        {role && (
          <div>
            {Object.values(can).some(Boolean) && (
              <div className="flex flex-wrap gap-1.5" aria-label="Agent actions">
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
                  <Button type="button" size="sm" variant="ghost" onClick={() => void act(async () => detail.setData(await api.post<CrewDetail>(path('/hidden'), { hidden: !role.hidden })), false)} disabled={busy} title={role.hidden ? 'New threads can start as it again' : 'No new thread starts as it on this machine'}>
                    {role.hidden ? 'Show' : 'Hide'}
                  </Button>
                )}
                {can.edited && (
                  <InlineConfirm label="Reset to built-in" icon="undo" confirmLabel="Reset" busyLabel="Resetting" onConfirm={() => act(() => api.post(path('/reset')))} />
                )}
                {can.delete && <InlineConfirm label="Delete" icon="trash" tone="danger" confirmLabel="Delete agent" busyLabel="Deleting" onConfirm={() => act(() => api.del(path()), true, true)} />}
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

        <Segmented
          label="Edit as"
          size="sm"
          value={memoryTab ? 'memory' : mode}
          onChange={(v) => {
            setMemoryTab(v === 'memory');
            if (v !== 'memory') switchTo(v);
          }}
          options={[
            { id: 'form', label: 'Form' },
            { id: 'markdown', label: 'Markdown' },
            ...(role
              ? [
                  {
                    id: 'memory' as const,
                    label: 'Memory',
                    ...(waiting > 0 && { badge: <span className="font-num text-[10.5px] text-fg-3 tabular-nums">{waiting}</span>, title: `${waiting} ${waiting === 1 ? 'lesson waits' : 'lessons wait'} for you` }),
                  },
                ]
              : []),
          ]}
        />

        {memoryTab && role ? (
          <RoleMemory role={role} />
        ) : mode === 'markdown' ? (
          <Field id="crew-md" label="Markdown" hint={builtIn ? 'Your overlay on the built-in: the fields it sets and your charter text. Saved as written.' : 'The whole agent: frontmatter and charter. Saved as written.'}>
            <textarea id="crew-md" aria-describedby={fieldHintId('crew-md')} className="field field-mono field-xs min-h-[360px] resize-y leading-relaxed" value={markdown} onChange={(e) => setMarkdown(e.target.value)} spellCheck={false} />
          </Field>
        ) : (
          <>
            <Section title="Identity">
              <Field id="crew-name" label="Name">
                <input id="crew-name" className="field" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Store ops" autoFocus={!id} />
              </Field>
              {!id && (
                <Field id="crew-id" label="Id" hint="The file's name and what threads store. It never changes.">
                  <input id="crew-id" aria-describedby={fieldHintId('crew-id')} {...IDENTIFIER} className="field field-mono" value={theId} onChange={(e) => setNewId(e.target.value)} placeholder="store-ops" />
                </Field>
              )}
              <Field id="crew-desc" label="Description" hint="The Conductor reads it to pick an agent for a task.">
                <textarea id="crew-desc" aria-describedby={fieldHintId('crew-desc')} className="field min-h-[64px] resize-y" value={draft.description} onChange={(e) => set('description', e.target.value)} placeholder="Hands-on store work: admin, theme checks, imports." />
              </Field>
              <Field label="Icon" hint={`Shown when there is no uploaded image. ${builtIn ? 'Without one, the built-in mark.' : 'Without one, its initials.'}`}>
                <IconPicker
                  inputId="crew-icon"
                  svg={false}
                  value={draft.icon}
                  name={draft.name || theId || 'Agent'}
                  avatarBg={draft.bg}
                  onChange={(v) => set('icon', v)}
                  preview={<AgentAvatar agent={{ id: theId, name: draft.name || theId || 'Agent', avatar: draft.icon || draft.bg ? { icon: draft.icon || undefined, bg: draft.bg || undefined } : undefined }} size={36} />}
                />
              </Field>
              <Field label="Icon background">
                <AvatarColorPicker icon={draft.icon} name={draft.name || theId || 'Agent'} value={draft.bg} manual={!!draft.bg} onChange={(v) => set('bg', v)} onAuto={() => set('bg', '')} />
              </Field>
            </Section>

            <Section title="Instructions">
              {builtIn && (
                <>
                  {locked.charter_mode ? (
                    <LockNote>{locked.charter_mode}</LockNote>
                  ) : (
                    <Segmented
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
                    ? 'Added after the built-in charter, so release fixes to it still reach this agent. {{user}} and the other placeholders are filled in.'
                    : builtIn
                      ? 'Replaces the built-in charter. Omni says when a release changes the one you replaced.'
                      : '{{user}} and the other placeholders are filled in when a thread starts.'
                }
              >
                <textarea id="crew-charter" aria-describedby={fieldHintId('crew-charter')} className="field field-mono field-xs min-h-[200px] resize-y leading-relaxed" value={draft.charter} onChange={(e) => set('charter', e.target.value)} placeholder="You operate on client stores. Dry run first." spellCheck={false} />
              </Field>
            </Section>

            <Section title="Run">
              <Field label="Harness, model and effort" hint="Default leaves it to the channel, then Auto. A thread or delegation that names its own run wins.">
                <RunDefaultsField value={{ harness: draft.harness, model: draft.model, effort: draft.effort }} onChange={(v) => setDraft((x) => (x ? { ...x, ...v } : x))} />
              </Field>
              {isRemoteHarnessId(draft.harness) && (
                <p className="text-[12.5px] leading-[18px] text-fg-2" data-remote-note>
                  {remoteRoleNote(draft.harness)}
                </p>
              )}
            </Section>

            <Section title="Where">
              <Field label="Default channel" hint="Where a thread starts as this agent when no channel is named.">
                <Picker size="field" label="Default channel" value={draft.channel} onChange={(v) => set('channel', v)} options={channelOptions} searchable />
              </Field>
            </Section>

            <Section title="Powers">
              <Switch label="The Conductor may delegate to it" hint="Off: the Conductor's list and the agent pickers leave it out, and delegate refuses it." checked={draft.delegatable} onChange={(v) => set('delegatable', v)} locked={locked.delegatable} />
              <Switch label="Conductor tools" hint="Omni's delegate tools in its threads, so it can hand work to other agents." checked={draft.conductorTools} onChange={(v) => set('conductorTools', v)} locked={locked.mcp} />
              <Switch label="Only routes work" hint="Runs without the shell, file edits, browser and subagents: it writes briefs and delegates. Needs the conductor tools." checked={draft.delegateOnly} onChange={(v) => set('delegateOnly', v)} locked={locked.delegate_only} />
              <Switch
                label="No file edits"
                hint={NO_EDITS_NOTE}
                checked={draft.noEdits && !draft.delegateOnly}
                onChange={(v) => set('noEdits', v)}
                locked={draft.delegateOnly ? 'Only routes work takes the shell and every edit tool away already.' : undefined}
              />
              <Switch
                label="Reviews work"
                hint="A review on a GPT model runs at high effort, and one the Conductor starts for a thread runs on the other model family from that thread's."
                checked={draft.review}
                onChange={(v) => set('review', v)}
                locked={locked.review}
              />
            </Section>

            <Section title="Memory">
              <Field label="Lessons" hint={ROLE_MEMORY_CHOICES.find((c) => c.id === draft.memory)?.hint}>
                <Segmented label="Lessons" size="sm" value={draft.memory} onChange={(v) => set('memory', v)} options={ROLE_MEMORY_CHOICES.map((c) => ({ id: c.id, label: c.label }))} />
              </Field>
              {draft.memory === 'read-write' && (
                <Field
                  label="What its threads propose"
                  hint={
                    draft.memoryWrites === 'auto'
                      ? 'Applies at once, and each lesson names its thread. A thread under an automation, or a lesson for every channel, still waits for you.'
                      : 'Waits for you in the Memory tab. Approve, edit or dismiss each one.'
                  }
                >
                  <Segmented
                    label="What its threads propose"
                    size="sm"
                    value={draft.memoryWrites}
                    onChange={(v) => set('memoryWrites', v)}
                    options={[
                      { id: 'review', label: 'Waits for me' },
                      { id: 'auto', label: 'Applies at once' },
                    ]}
                  />
                </Field>
              )}
            </Section>
          </>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
      <Footer page={page}>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" busy={busy} disabled={!!problem} title={problem ?? undefined}>
          {id ? 'Save' : 'Create'}
        </Button>
      </Footer>
    </form>
  );
}

/** A built-in's charter beside the one this role runs with, and the three ways out of a changed built-in. */
function CompareView({ detail, page, busy, error, onBack, onPick }: { detail: CrewDetail; page?: boolean; busy: boolean; error: string | null; onBack: () => void; onPick: (body: object) => void }) {
  const rows = lineDiff(detail.charters.builtIn ?? '', detail.charters.effective);
  const own = detail.charters.own ?? '';
  const changes = rows.filter((r) => r.kind !== 'same').length;
  const region = useScrollRegion<HTMLDivElement>('Built-in and your charter, line by line', 'both');
  return (
    <div>
      <div className={page ? 'space-y-3 pb-5' : 'space-y-3 px-6 pb-5'}>
        <p className="text-[12.5px] text-fg-3">
          {detail.role.charterMode === 'append' ? 'The built-in charter, and what your additions put after it.' : 'The built-in charter, and the one you replaced it with.'} {changes ? `${changes} changed ${changes === 1 ? 'line' : 'lines'}.` : 'No difference.'}
        </p>
        <div className="flex gap-3 text-[11.5px] text-fg-3">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--diff-del-bg)] shadow-[inset_0_0_0_1px_var(--diff-del-fg)]" />Only in the built-in</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--diff-add-bg)] shadow-[inset_0_0_0_1px_var(--diff-add-fg)]" />Only in yours</span>
        </div>
        {/* A scroll region the keyboard can scroll, its lines plain text: a screen reader hears which side a changed line is on. */}
        <div className="max-h-[50dvh] overflow-auto rounded-[14px] bg-surface py-2 font-mono text-[11.5px] leading-[18px]" {...region}>
          {rows.map((r, i) => (
            <div
              key={i}
              className={`flex gap-2 px-3 whitespace-pre-wrap ${r.kind === 'add' ? 'bg-[var(--diff-add-bg)] text-[var(--diff-add-fg)]' : r.kind === 'del' ? 'bg-[var(--diff-del-bg)] text-[var(--diff-del-fg)]' : 'text-fg-2'}`}
            >
              <span aria-hidden="true" className="w-3 shrink-0 select-none">{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ''}</span>
              <span className="min-w-0 break-words">
                {r.kind !== 'same' && <span className="sr-only">{r.kind === 'add' ? 'Only in yours: ' : 'Only in the built-in: '}</span>}
                {r.text || ' '}
              </span>
            </div>
          ))}
        </div>
        {detail.role.builtInChanged && (
          <div className="space-y-2 rounded-[14px] bg-surface-2 p-3.5">
            <p className="text-[12.5px] text-fg-2">The built-in changed since you replaced it. Pick what this agent runs with:</p>
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
      <Footer page={page}>
        <Button variant="ghost" icon="chevronLeft" onClick={onBack} disabled={busy}>
          Back
        </Button>
      </Footer>
    </div>
  );
}

function DuplicateView({ from, page, busy, error, onBack, onDuplicate }: { from: CrewRole; page?: boolean; busy: boolean; error: string | null; onBack: () => void; onDuplicate: (id: string, name: string) => void }) {
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
      <div className={page ? 'space-y-4 pb-5' : 'space-y-4 px-6 pb-5'}>
        <p className="text-[12.5px] text-fg-3">
          A new agent of your own with everything {from.name} has now: its fields and its whole charter.{from.kind !== 'own' && ' Unlike the built-in, it does not change with a release.'}
        </p>
        <Field id="dup-name" label="Name">
          <input id="dup-name" className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field id="dup-id" label="Id">
          <input id="dup-id" {...IDENTIFIER} className="field field-mono" value={theId} onChange={(e) => setId(e.target.value)} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
      <Footer page={page}>
        <Button variant="ghost" icon="chevronLeft" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button type="submit" variant="primary" busy={busy} disabled={!name.trim() || !theId}>
          Duplicate
        </Button>
      </Footer>
    </form>
  );
}
