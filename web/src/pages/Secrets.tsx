import { useMemo, useState, type FormEvent } from 'react';
import { api, errorText, useApi, type SecretRow } from '../api.ts';
import { Button, ConfirmDialog, Empty, ErrorNote, Icon, IconButton, Label, Loading, PageHeader } from '../components/ui.tsx';
import { relTime } from '../format.ts';
import { href } from '../router.ts';
import { useApp } from '../store.tsx';

const NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

function scopeLabel(scope: string, name: (id: string) => string | undefined) {
  if (scope === 'global') return 'Global';
  const id = scope.replace(/^channel:/, '');
  return `#${name(id) ?? id}`;
}

export function SecretsPage() {
  const { channels, channel } = useApp();
  const res = useApi<SecretRow[]>('/secrets');

  const [scope, setScope] = useState('global');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [pending, setPending] = useState<SecretRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const channelName = (id: string) => channel(id)?.name;

  const groups = useMemo(() => {
    const m = new Map<string, SecretRow[]>();
    for (const s of res.data ?? []) {
      const list = m.get(s.scope) ?? [];
      list.push(s);
      m.set(s.scope, list);
    }
    // Global first, then channels alphabetically.
    return [...m.entries()].sort(([a], [b]) => (a === 'global' ? -1 : b === 'global' ? 1 : a.localeCompare(b)));
  }, [res.data]);

  const nameValid = NAME_RE.test(name);
  const exists = (res.data ?? []).some((s) => s.scope === scope && s.name === name);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!nameValid) return setFormError('Use UPPER_SNAKE_CASE: a capital letter, then capitals, digits or underscores.');
    if (!value) return setFormError('Paste a value.');
    if (/[\r\n]/.test(value)) return setFormError('The value must be a single line.');
    setSaving(true);
    setFormError(null);
    setSavedMsg(null);
    try {
      await api.post('/secrets', { scope, name, value });
      setValue('');
      setSavedMsg(`${exists ? 'Updated' : 'Saved'} ${name} (${scopeLabel(scope, channelName)})`);
      setName('');
      res.reload();
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!pending) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.del('/secrets', { scope: pending.scope, name: pending.name });
      setPending(null);
      res.reload();
    } catch (err) {
      setDeleteError(errorText(err));
    } finally {
      setDeleting(false);
    }
  };

  const scopeOptions = [{ value: 'global', label: 'Global (all channels)' }, ...channels.map((c) => ({ value: `channel:${c.id}`, label: `#${c.name}` }))];

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader title="Secrets" subtitle="API keys and tokens for the crew. Stored in the macOS Keychain, never in the database." />
      <div className="mx-auto max-w-2xl space-y-5 px-4 pt-5 pb-16 md:px-8">
        <div className="flex gap-2.5 rounded-xl border border-line bg-surface-2 p-3 text-[12.5px] leading-relaxed text-fg-2">
          <Icon name="lock" size={15} className="mt-0.5 text-fg-3" />
          <div>
            Values live in the Keychain under the service <span className="font-mono text-[12px]">omni-os</span> and are injected as environment variables when a thread
            runs. A channel secret overrides a global one with the same name. Omni never shows a value again after you save it; to change one, save it again with the same
            name.
          </div>
        </div>

        <form onSubmit={save} className="space-y-3 rounded-xl border border-line bg-surface p-4" autoComplete="off">
          <h2 className="text-[13px] font-semibold text-fg-2">Add or replace</h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
            <div>
              <Label htmlFor="sec-scope">Scope</Label>
              <select id="sec-scope" className="field" value={scope} onChange={(e) => setScope(e.target.value)}>
                {scopeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="sec-name">Name</Label>
              <input
                id="sec-name"
                className="field font-mono !text-[13px]"
                value={name}
                onChange={(e) => {
                  setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'));
                  setSavedMsg(null);
                }}
                placeholder="SHOPIFY_ADMIN_TOKEN"
                spellCheck={false}
                autoCapitalize="characters"
                autoComplete="off"
                aria-invalid={!!name && !nameValid}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="sec-value" hint={exists ? 'A secret with this name exists in this scope. Saving replaces it.' : undefined}>
              Value
            </Label>
            <input
              id="sec-value"
              type="password"
              autoComplete="new-password"
              className="field font-mono !text-[13px]"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste the value"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
            />
          </div>
          {formError && <ErrorNote>{formError}</ErrorNote>}
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" icon="key" busy={saving} disabled={!name || !value}>
              {exists ? 'Replace secret' : 'Save secret'}
            </Button>
            {savedMsg && <span className="text-[12.5px] text-ok">{savedMsg}</span>}
          </div>
        </form>

        {res.error ? (
          <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote>
        ) : !res.data ? (
          <Loading />
        ) : groups.length === 0 ? (
          <Empty icon="key" title="No secrets yet">
            Add a token above, for example a Shopify Admin API token scoped to the client's channel.
          </Empty>
        ) : (
          <div className="space-y-4">
            {groups.map(([sc, rows]) => (
              <section key={sc}>
                <h3 className="mb-1 flex items-center gap-2 px-1 text-[12px] font-semibold text-fg-3">
                  {sc === 'global' ? (
                    'Global'
                  ) : (
                    <a href={href.channel(sc.replace(/^channel:/, ''))} className="hover:text-fg">
                      {scopeLabel(sc, channelName)}
                    </a>
                  )}
                  <span className="font-normal text-fg-4">{rows.length}</span>
                </h3>
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                  {rows.map((s) => (
                    <li key={s.name} className="flex items-center gap-3 px-3 py-2">
                      <Icon name="key" size={13} className="text-fg-4" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{s.name}</span>
                      <span className="shrink-0 text-[11.5px] text-fg-4" title={s.updated_at}>
                        {relTime(s.updated_at)}
                      </span>
                      <IconButton
                        icon="trash"
                        label={`Delete ${s.name}`}
                        size={14}
                        className="hover:!text-bad"
                        onClick={() => {
                          setDeleteError(null);
                          setPending(s);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!pending}
        title={pending ? `Delete ${pending.name}?` : ''}
        confirmLabel="Delete secret"
        danger
        busy={deleting}
        error={deleteError}
        onCancel={() => setPending(null)}
        onConfirm={remove}
      >
        {pending && (
          <p>
            Removes it from the Keychain for <span className="font-medium">{scopeLabel(pending.scope, channelName)}</span>. Threads that rely on it will fail until you add it
            again.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
