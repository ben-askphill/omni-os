import { useMemo, useState, type FormEvent } from 'react';
import { api, errorText, useApi, type SecretRow } from '../api.ts';
import { Button, Empty, ErrorNote, Icon, InlineConfirm, Label, Loading, PageHeader, Picker, type PickerOption } from '../components/ui.tsx';
import { relTime } from '../format.ts';
import { href } from '../router.ts';
import { useApp } from '../store.tsx';

const NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Names Omni looks up itself. Values still go to the Keychain; this only fills the form. */
const KNOWN_GLOBALS: { name: string; blurb: string }[] = [
  { name: 'HERMES_API_KEY', blurb: 'Hermes API bearer token. Global. Sent on HTTP requests, not in a shell environment.' },
];

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

  const [deleteError, setDeleteError] = useState<{ key: string; msg: string } | null>(null);

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

  // Runs once the undo fuse burns out, so an accidental click costs nothing.
  const remove = async (s: SecretRow) => {
    const key = `${s.scope}/${s.name}`;
    setDeleteError(null);
    try {
      await api.del('/secrets', { scope: s.scope, name: s.name });
      res.reload();
    } catch (err) {
      setDeleteError({ key, msg: errorText(err) });
      throw err;
    }
  };

  const scopeOptions: PickerOption<string>[] = [
    { value: 'global', label: 'Global', sub: 'All channels', icon: 'globe' },
    ...channels.map((c) => ({ value: `channel:${c.id}`, label: `#${c.name}`, sub: c.kind, avatar: c.name, icon: c.id === 'conductor' ? ('target' as const) : undefined })),
  ];

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader width="max-w-2xl" title="Secrets" subtitle="API keys and tokens for the crew. Stored in the macOS Keychain, never in the database." />
      <div className="mx-auto max-w-2xl space-y-5 px-4 pt-5 pb-16 md:px-8">
        <div className="flex gap-3 rounded-[20px] bg-surface p-4 text-[12.5px] leading-relaxed text-fg-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg text-fg-3">
            <Icon name="lock" size={15} />
          </span>
          <div>
            Values live in the Keychain under the service <span className="font-mono text-[12px]">omni-os</span> and are injected as environment variables when a thread
            runs. A channel secret overrides a global one with the same name. Omni never shows a value again after you save it; to change one, save it again with the same
            name.
          </div>
        </div>

        <div className="space-y-2">
          <div className="label-mono px-1">Known global secrets</div>
          <ul className="space-y-2">
            {KNOWN_GLOBALS.map((k) => {
              const saved = (res.data ?? []).some((s) => s.scope === 'global' && s.name === k.name);
              return (
                <li key={k.name}>
                  <button
                    type="button"
                    onClick={() => {
                      setScope('global');
                      setName(k.name);
                      setSavedMsg(null);
                      setFormError(null);
                    }}
                    className="press flex w-full items-center gap-3 rounded-[18px] bg-surface px-3 py-2.5 text-left"
                  >
                    <span className="font-mono text-[12.5px]">{k.name}</span>
                    {saved && <span className="text-[11px] font-medium text-ok">saved</span>}
                    <span className="min-w-0 flex-1 text-[12px] leading-snug text-fg-3">{k.blurb}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <form onSubmit={save} className="space-y-4 rounded-[24px] p-5 shadow-[inset_0_0_0_1px_var(--line)]" autoComplete="off">
          <h2 className="font-display text-[16px]">Add or replace</h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
            <div>
              <Label>Scope</Label>
              <Picker label="Scope" value={scope} onChange={setScope} options={scopeOptions} searchable={scopeOptions.length > 7} className="w-full" />
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
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" icon="key" busy={saving} disabled={!name || !value}>
              {exists ? 'Replace secret' : 'Save secret'}
            </Button>
            {savedMsg && (
              <span className="pop-in inline-flex items-center gap-1.5 text-[12.5px] text-ok">
                <Icon name="check" size={13} strokeWidth={2.25} /> {savedMsg}
              </span>
            )}
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
                <h3 className="label-mono mb-2 flex items-center gap-2 px-2">
                  {sc === 'global' ? (
                    'Global'
                  ) : (
                    <a href={href.channel(sc.replace(/^channel:/, ''))} className="hover:text-fg">
                      {scopeLabel(sc, channelName)}
                    </a>
                  )}
                  <span className="text-fg-4/70">{rows.length}</span>
                </h3>
                <ul className="rounded-[20px] bg-surface p-1.5">
                  {rows.map((s) => {
                    const key = `${s.scope}/${s.name}`;
                    return (
                      <li key={s.name} className="rounded-2xl px-2.5 py-1.5">
                        <div className="flex min-h-9 items-center gap-3">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-bg text-fg-4">
                            <Icon name="key" size={13} />
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{s.name}</span>
                          <span className="hidden shrink-0 font-num text-[11px] text-fg-4 sm:inline" title={s.updated_at}>
                            {relTime(s.updated_at)}
                          </span>
                          <InlineConfirm label="Delete" icon="trash" confirmLabel="Delete" doneLabel="Deleted" busyLabel="Deleting" undoMs={5000} onConfirm={() => remove(s)} />
                        </div>
                        {deleteError?.key === key && <div className="pt-1 pb-1 pl-10 text-[12px] text-bad">{deleteError.msg}</div>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
