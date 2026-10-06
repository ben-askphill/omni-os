import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, errorText, useApi, type Channel, type HarnessWithRunning } from '../api.ts';
import { EffortPicker, ModelPicker } from '../components/ModelPicker.tsx';
import { Avatar, Button, ErrorNote, Icon, InlineConfirm, Label, PageHeader, Segmented, StatusDot, Toggle } from '../components/ui.tsx';
import { CHANNEL_GLYPHS, glyphIcon, parseChannelIcon, readSvgIcon } from '../../../shared/channel-icon.ts';
import { readDesignSystem } from '../../../shared/design-system.ts';
import { bytes, lastGrapheme, slugify } from '../format.ts';
import { navigate } from '../router.ts';
import { useApp } from '../store.tsx';

interface FormState {
  id: string;
  name: string;
  kind: 'client' | 'internal' | 'personal';
  repo_path: string;
  github_repo: string;
  use_worktree: boolean;
  base_dir: string;
  store_domain: string;
  portal_slug: string;
  showBrowser: boolean;
  notes: string;
  icon: string;
  /** The default model as a picker choice: model '' is the harness default. Harness '' is no default at all. */
  run: { harness: string; model: string; effort: string };
}

function fromChannel(c?: Channel): FormState {
  return {
    id: c?.id ?? '',
    name: c?.name ?? '',
    kind: c && c.kind !== 'system' ? c.kind : 'client',
    repo_path: c?.repo_path ?? '',
    github_repo: c?.github_repo ?? '',
    use_worktree: c ? c.use_worktree === 1 : true,
    base_dir: c?.base_dir ?? '',
    store_domain: c?.store_domain ?? '',
    portal_slug: c?.portal_slug ?? '',
    showBrowser: c ? c.browser_headless === 0 : false,
    notes: c?.notes ?? '',
    icon: c?.icon ?? '',
    run: { harness: c?.default_harness ?? '', model: c?.default_model ?? '', effort: c?.default_effort ?? '' },
  };
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <Label hint={hint} htmlFor={htmlFor}>
        {label}
      </Label>
      {children}
    </div>
  );
}

/** Bigger than any SVG that could be kept once cleaned, so it is refused before being read. */
const SVG_FILE_MAX = 512 * 1024;

function IconPicker({ value, name, onChange }: { value: string; name: string; onChange: (v: string) => void }) {
  const mark = parseChannelIcon(value);
  const fileRef = useRef<HTMLInputElement>(null);
  const [svgError, setSvgError] = useState<string | null>(null);
  const change = (v: string) => {
    setSvgError(null);
    onChange(v);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > SVG_FILE_MAX) throw new Error('That SVG is too big: keep it under 20 KB.');
      change(readSvgIcon(await file.text()));
    } catch (err) {
      setSvgError(errorText(err));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Avatar name={name} channelIcon={value} size={36} />
        <input
          id="ch-icon"
          className="field w-24 text-center !text-[18px] placeholder:!text-[13px]"
          value={mark?.kind === 'emoji' ? mark.text : ''}
          onChange={(e) => change(lastGrapheme(e.target.value))}
          placeholder="Emoji"
          aria-label="Emoji"
        />
        <Button type="button" icon="image" onClick={() => fileRef.current?.click()}>
          {mark?.kind === 'svg' ? 'Replace SVG' : 'Upload SVG'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".svg,image/svg+xml"
          className="hidden"
          aria-label="SVG file"
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {value && (
          <Button type="button" onClick={() => change('')}>
            Clear
          </Button>
        )}
      </div>
      {svgError && <ErrorNote>{svgError}</ErrorNote>}
      <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-1">
        {CHANNEL_GLYPHS.map((g) => {
          const on = mark?.kind === 'glyph' && mark.name === g;
          return (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={g}
              title={g}
              onClick={() => change(on ? '' : glyphIcon(g))}
              className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${on ? 'bg-fg text-on-ink' : 'hov text-fg-2 [--hov:var(--surface)]'}`}
            >
              <Icon name={g} size={17} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The model and effort a new thread in the channel starts on, unless the thread or its role picks. */
function RunDefaultsField({ value, onChange }: { value: FormState['run']; onChange: (v: FormState['run']) => void }) {
  const { data: harnesses, reload } = useApi<HarnessWithRunning[]>('/harnesses');
  if (!harnesses) return null;
  const choice = { harness: value.harness || 'claude-code', model: value.model };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ModelPicker
        harnesses={harnesses}
        onOpen={reload}
        placeholder="Claude Code default"
        value={choice}
        onChange={(c) => onChange({ harness: c.harness, model: c.model, effort: '' })}
      />
      <EffortPicker harnesses={harnesses} choice={choice} value={value.effort} onChange={(effort) => onChange({ ...choice, effort })} />
      {(value.harness || value.model || value.effort) && (
        <Button type="button" onClick={() => onChange({ harness: '', model: '', effort: '' })}>
          Reset
        </Button>
      )}
    </div>
  );
}

/** Sent as soon as it is chosen, not with Save: the file is too big to hold in the form's state. */
function DesignSystemPicker({ channel, onChange }: { channel: Channel; onChange: (c: Channel) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/channels/${encodeURIComponent(channel.id)}/design-system`;

  const send = async (run: () => Promise<Channel>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await run());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const upload = (file: File | undefined) =>
    file &&
    send(async () => api.put<Channel>(url, { name: file.name, html: readDesignSystem(await file.text()) }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {channel.design_system_name && (
          <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-[13px] text-fg">
            <Icon name="file" size={14} />
            <a className="hov" href={`/api${url}`} target="_blank" rel="noreferrer" title="Open the file">
              {channel.design_system_name}
            </a>
            <span className="text-fg-3">{bytes(channel.design_system_size)}</span>
          </span>
        )}
        <Button type="button" icon="file" busy={busy} onClick={() => fileRef.current?.click()}>
          {channel.design_system_name ? 'Replace file' : 'Upload HTML file'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".html,.htm,text/html"
          className="hidden"
          aria-label="Design system file"
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {channel.design_system_name && (
          <Button type="button" disabled={busy} onClick={() => void send(() => api.del<Channel>(url))}>
            Remove
          </Button>
        )}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-[24px] p-5 shadow-[inset_0_0_0_1px_var(--line)]">
      <h2 className="font-display text-[16px]">{title}</h2>
      {children}
    </section>
  );
}

export function ChannelSettingsForm({ existing }: { existing?: Channel }) {
  const { reloadChannels } = useApp();
  const [f, setF] = useState<FormState>(() => fromChannel(existing));
  const [idTouched, setIdTouched] = useState(!!existing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const isNew = !existing;
  const isSystem = existing?.kind === 'system';

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setSaved(false);
    setF((prev) => {
      const next = { ...prev, [k]: v };
      if (k === 'name' && !idTouched) next.id = slugify(String(v));
      return next;
    });
  };

  const idValid = /^[a-z0-9-]{2,40}$/.test(f.id);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setError('Give the channel a name.');
    if (isNew && !idValid) return setError('The id needs 2 to 40 lowercase letters, digits or dashes.');
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: f.name.trim(),
      repo_path: orNull(f.repo_path),
      github_repo: orNull(f.github_repo),
      use_worktree: f.use_worktree ? 1 : 0,
      base_dir: orNull(f.base_dir),
      store_domain: orNull(f.store_domain)?.replace(/^https?:\/\//, '').replace(/\/.*$/, '') ?? null,
      portal_slug: orNull(f.portal_slug),
      browser_headless: f.showBrowser ? 0 : 1,
      notes: orNull(f.notes),
      icon: orNull(f.icon),
      default_harness: orNull(f.run.harness),
      default_model: orNull(f.run.model),
      default_effort: orNull(f.run.effort),
    };
    if (!isSystem) body.kind = f.kind;
    try {
      if (isNew) {
        const ch = await api.post<Channel>('/channels', { id: f.id, ...body });
        await reloadChannels();
        navigate(`/c/${ch.id}`);
      } else {
        const ch = await api.patch<Channel>(`/channels/${encodeURIComponent(existing.id)}`, body);
        await reloadChannels();
        setF(fromChannel(ch));
        setSaved(true);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  // Reversible from the channel URL (it offers Unarchive), so an inline ask is enough.
  const archive = async () => {
    if (!existing) return;
    setArchiveError(null);
    try {
      await api.patch(`/channels/${encodeURIComponent(existing.id)}`, { archived: 1 });
      await reloadChannels();
      navigate('/');
    } catch (err) {
      setArchiveError(errorText(err));
      throw err;
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Section title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="ch-name">
            <input id="ch-name" className="field" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Volero" autoFocus={isNew} />
          </Field>
          <Field
            label="Id"
            htmlFor="ch-id"
            hint={isNew ? 'Lowercase slug, used in URLs and by the Conductor. Cannot change later.' : 'Fixed after creation.'}
          >
            <input
              id="ch-id"
              className="field font-mono !text-[13px]"
              value={f.id}
              disabled={!isNew}
              onChange={(e) => {
                setIdTouched(true);
                set('id', e.target.value.toLowerCase());
              }}
              placeholder="volero"
              aria-invalid={isNew && !!f.id && !idValid}
            />
          </Field>
        </div>
        <Field label="Icon" htmlFor="ch-icon" hint="Shown in the sidebar and on the channel. Type an emoji (Ctrl+Cmd+Space opens the picker), upload an SVG or pick an icon. Empty uses the first letter.">
          <IconPicker value={f.icon} name={f.name || f.id} onChange={(v) => set('icon', v)} />
        </Field>
        {!isSystem && (
          <Field label="Kind">
            <Segmented
              radio
              label="Kind"
              value={f.kind}
              onChange={(k) => set('kind', k)}
              options={[
                { id: 'client', label: 'Client' },
                { id: 'internal', label: 'Internal' },
                { id: 'personal', label: 'Personal' },
              ]}
            />
          </Field>
        )}
        <Field label="Default model" hint="What a new thread here starts on. A thread or crew role that picks its own wins.">
          <RunDefaultsField value={f.run} onChange={(v) => set('run', v)} />
        </Field>
        {existing && (
          <Field
            label="Design system"
            hint="One standalone HTML file with your tokens, type and components. Threads in this channel read it before they write an HTML page, so every artifact looks the same. Saved as soon as you pick the file."
          >
            <DesignSystemPicker channel={existing} onChange={() => void reloadChannels()} />
          </Field>
        )}
        <Field label="Notes" htmlFor="ch-notes" hint="Added to every thread's system prompt in this channel. Keep it short: who the client is, conventions, what not to touch.">
          <textarea id="ch-notes" className="field min-h-[84px] resize-y" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </Section>

      <Section title="Code">
        <Field label="Repo path" htmlFor="ch-repo" hint="Absolute path to a local git repo. Enables per-thread worktrees and the PRs tab.">
          <input id="ch-repo" className="field font-mono !text-[13px]" value={f.repo_path} onChange={(e) => set('repo_path', e.target.value)} placeholder="/Users/benrosenberg/code/apa-volero" spellCheck={false} />
        </Field>
        <Field label="GitHub repo" htmlFor="ch-gh" hint="owner/name. Auto-detected from the repo path when left empty.">
          <input id="ch-gh" className="field font-mono !text-[13px]" value={f.github_repo} onChange={(e) => set('github_repo', e.target.value)} placeholder="askphill/apa-volero" spellCheck={false} />
        </Field>
        <div className="flex items-start justify-between gap-4 rounded-[18px] bg-surface px-4 py-3">
          <div>
            <div className="text-[13px] font-medium text-fg">Worktree per thread</div>
            <div className="text-[12px] text-fg-3">Each thread gets its own branch (omni/...) so parallel work never collides. Off runs in the repo itself.</div>
          </div>
          <Toggle checked={f.use_worktree} onChange={(v) => set('use_worktree', v)} label="Worktree per thread" disabled={!f.repo_path.trim()} />
        </div>
        <Field label="Base directory" htmlFor="ch-base" hint="Where threads run when there is no repo. Defaults to the brain folder (phillbert) so skills load.">
          <input id="ch-base" className="field font-mono !text-[13px]" value={f.base_dir} onChange={(e) => set('base_dir', e.target.value)} placeholder="/Users/benrosenberg/phillbert" spellCheck={false} />
        </Field>
      </Section>

      <Section title="Store and browser">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Store domain" htmlFor="ch-store" hint="The myshopify domain, e.g. volero-eu.myshopify.com">
            <input id="ch-store" className="field font-mono !text-[13px]" value={f.store_domain} onChange={(e) => set('store_domain', e.target.value)} placeholder="volero-eu.myshopify.com" spellCheck={false} />
          </Field>
          <Field label="Portal slug" htmlFor="ch-portal" hint="Ask Phill Portal company slug, for client context.">
            <input id="ch-portal" className="field font-mono !text-[13px]" value={f.portal_slug} onChange={(e) => set('portal_slug', e.target.value)} placeholder="volero" spellCheck={false} />
          </Field>
        </div>
        <div className="flex items-start justify-between gap-4 rounded-[18px] bg-surface px-4 py-3">
          <div>
            <div className="text-[13px] font-medium text-fg">Show the browser window</div>
            <div className="text-[12px] text-fg-3">Off runs the channel browser headless. Turn on to watch it or to log in by hand. Logins persist per channel.</div>
          </div>
          <Toggle checked={f.showBrowser} onChange={(v) => set('showBrowser', v)} label="Show the browser window" />
        </div>
      </Section>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" busy={busy}>
          {isNew ? 'Create channel' : 'Save changes'}
        </Button>
        {saved && (
          <span className="pop-in inline-flex items-center gap-1.5 text-[12.5px] text-fg-2">
            <StatusDot status="done" /> Saved
          </span>
        )}
        {existing && !isSystem && existing.id !== 'inbox' && (
          <InlineConfirm className="ml-auto" label="Archive channel" icon="archive" confirmLabel="Archive" busyLabel="Archiving" onConfirm={archive} />
        )}
      </div>
      {archiveError && <ErrorNote>{archiveError}</ErrorNote>}

    </form>
  );
}

export function NewChannelPage() {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader width="max-w-2xl" title="New channel" subtitle="One channel per client or project. Threads, PRs, secrets and the browser profile are scoped to it." />
      <div className="mx-auto max-w-2xl px-4 pt-2 pb-16 md:px-8">
        <ChannelSettingsForm />
      </div>
    </div>
  );
}
