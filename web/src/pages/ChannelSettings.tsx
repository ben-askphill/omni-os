import { useState, type FormEvent, type ReactNode } from 'react';
import { api, errorText, type Channel } from '../api.ts';
import { Button, ConfirmDialog, ErrorNote, Label, PageHeader, Toggle } from '../components/ui.tsx';
import { slugify } from '../format.ts';
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <h2 className="text-[13px] font-semibold text-fg-2">{title}</h2>
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
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
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

  const archive = async () => {
    if (!existing) return;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      await api.patch(`/channels/${encodeURIComponent(existing.id)}`, { archived: 1 });
      await reloadChannels();
      setArchiveOpen(false);
      navigate('/');
    } catch (err) {
      setArchiveError(errorText(err));
    } finally {
      setArchiveBusy(false);
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
        {!isSystem && (
          <Field label="Kind">
            <div className="flex gap-1">
              {(['client', 'internal', 'personal'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set('kind', k)}
                  className={`h-8 rounded-md border px-3 text-[13px] capitalize transition-colors ${
                    f.kind === k ? 'border-fg bg-fg text-bg' : 'border-line-strong text-fg-2 hover:bg-surface-2'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
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
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[13px] font-medium text-fg-2">Worktree per thread</div>
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
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[13px] font-medium text-fg-2">Show the browser window</div>
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
        {saved && <span className="text-[12.5px] text-ok">Saved</span>}
        {existing && !isSystem && existing.id !== 'inbox' && (
          <Button variant="danger-ghost" icon="archive" className="ml-auto" onClick={() => setArchiveOpen(true)}>
            Archive channel
          </Button>
        )}
      </div>

      {existing && (
        <ConfirmDialog
          open={archiveOpen}
          title={`Archive #${existing.id}?`}
          confirmLabel="Archive"
          danger
          busy={archiveBusy}
          error={archiveError}
          onCancel={() => setArchiveOpen(false)}
          onConfirm={archive}
        >
          <p>The channel leaves the sidebar. Its threads, artifacts and search history stay in the database.</p>
        </ConfirmDialog>
      )}
    </form>
  );
}

export function NewChannelPage() {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader title="New channel" subtitle="One channel per client or project. Threads, PRs, secrets and the browser profile are scoped to it." />
      <div className="mx-auto max-w-2xl px-4 pt-5 pb-16 md:px-8">
        <ChannelSettingsForm />
      </div>
    </div>
  );
}
