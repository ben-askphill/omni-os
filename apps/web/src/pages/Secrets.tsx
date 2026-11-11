import { useMemo, useRef, useState, type FormEvent } from 'react';
import { relTime } from '@omni/shared/format.ts';
import { api, errorText, useApi, type SecretRow } from '../api.ts';
import { Button, Empty, ErrorNote, Icon, InlineConfirm, Label, Loading, Picker, StatusDot, type PickerOption } from '../components/ui.tsx';
import { StaticMark } from '../components/brand.tsx';
import { href } from '../router.ts';
import { useApp, useSecretStoreLabel } from '../store.tsx';
import { Card, FootNote } from './settings-parts.tsx';

const NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Names Omni looks up itself. Values still go to the secret store; this only fills the form. */
const KNOWN_GLOBALS: { name: string; blurb: string; grok?: true }[] = [
  { name: 'HERMES_API_KEY', blurb: 'Hermes API bearer token. Global. Sent on HTTP requests, not in a shell environment.' },
  { name: 'GROKBOT_WEBHOOK_URL', blurb: 'Grok Bot webhook URL from the Omni OS requests routine. Global. Send to Grok Bot posts here. Stays on the server.', grok: true },
  { name: 'GROKBOT_WEBHOOK_AUTH', blurb: 'Authorization value for that webhook, pasted as Grok Bot shows it. Global. Stays on the server.', grok: true },
];

function scopeLabel(scope: string, name: (id: string) => string | undefined) {
  if (scope === 'global') return 'Global';
  const id = scope.replace(/^channel:/, '');
  return `#${name(id) ?? id}`;
}

// Settings, Secrets: a form that adds or replaces one, the known ones Omni itself uses, then the names by scope, each
// with Delete behind a confirm and an undo. A channel's secret overrides a global one with the same name.
export function SecretsSection() {
  const { channels, channel, status, reloadStatus } = useApp();
  const res = useApi<SecretRow[]>('/secrets');
  const store = useSecretStoreLabel();

  const [scope, setScope] = useState('global');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

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
      setSavedMsg(`${exists ? 'Replaced' : 'Added'} ${name} (${scopeLabel(scope, channelName)})`);
      setName('');
      res.reload();
      void reloadStatus();
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
      void reloadStatus();
    } catch (err) {
      setDeleteError({ key, msg: errorText(err) });
      throw err;
    }
  };

  const scopeOptions: PickerOption<string>[] = [
    { value: 'global', label: 'Global', sub: 'All channels', icon: 'globe' },
    ...channels.map((c) => ({ value: `channel:${c.id}`, label: `#${c.name}`, sub: c.kind, avatar: c.name, avatarBg: c.avatar_bg, channelIcon: c.icon, lead: c.id === 'conductor' ? <StaticMark size={13} title="" /> : undefined })),
  ];

  return (
    <>
      <form onSubmit={save} autoComplete="off">
        <Card title="Add or replace" subtitle="A channel secret overrides a global one with the same name. Omni never shows a value again after you add it.">
          <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
            <div>
              <Label htmlFor="sec-scope">Scope</Label>
              <Picker id="sec-scope" label="Scope" size="field" value={scope} onChange={setScope} options={scopeOptions} searchable={scopeOptions.length > 7} />
            </div>
            <div>
              <Label htmlFor="sec-name">Name</Label>
              <input
                id="sec-name"
                ref={nameInput}
                className="field h-10 font-mono !text-[13px]"
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
              className="field h-10 font-mono !text-[13px]"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste the value"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
            />
          </div>
          {formError && <ErrorNote>{formError}</ErrorNote>}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="min-w-0 flex-1 text-[12.5px] text-fg-3" role="status">
              {savedMsg ?? 'Saving the same name again replaces the value.'}
            </span>
            <Button type="submit" variant="primary" size="sm" icon="key" busy={saving} disabled={!name || !value}>
              {exists ? 'Replace secret' : 'Add secret'}
            </Button>
          </div>
        </Card>
      </form>

      <Card title="Known secrets" subtitle="Secrets Omni itself uses. Pick one to fill in the form.">
        <ul className="divide-y divide-line">
          {KNOWN_GLOBALS.filter((k) => !k.grok || status?.grokBot).map((k) => {
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
                    nameInput.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                  }}
                  className="group flex w-full items-center gap-3 py-2.5 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[12.5px] group-hover:underline group-hover:underline-offset-2">{k.name}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-fg-3">{k.blurb}</span>
                  </span>
                  <span className="inline-flex w-20 shrink-0 items-center gap-1.5 text-[12.5px] whitespace-nowrap text-fg-2">
                    {saved ? (
                      <>
                        <StatusDot status="done" size={7} /> Saved
                      </>
                    ) : (
                      <span className="text-fg-3">Not set</span>
                    )}
                  </span>
                  <Icon name="chevronRight" size={14} className="shrink-0 text-fg-3" />
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      {res.error ? (
        <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote>
      ) : !res.data ? (
        <Loading />
      ) : groups.length === 0 ? (
        <Empty icon="key" title="No secrets yet">
          Add a token above, for example a Shopify Admin API token scoped to the client's channel.
        </Empty>
      ) : (
        groups.map(([sc, rows], i) => (
          <Card
            key={sc}
            title={
              <>
                {sc === 'global' ? (
                  'Global'
                ) : (
                  <a href={href.channel(sc.replace(/^channel:/, ''))} className="hover:underline hover:underline-offset-2">
                    {scopeLabel(sc, channelName)}
                  </a>
                )}{' '}
                <span className="font-num text-fg-3">· {rows.length}</span>
              </>
            }
            subtitle={i === 0 ? `Deleting a secret removes it from ${store}. Threads that use it fail until you add it again.` : undefined}
          >
            <ul className="divide-y divide-line">
              {rows.map((s) => {
                const key = `${s.scope}/${s.name}`;
                return (
                  <li key={s.name} className="py-1.5">
                    <div className="flex min-h-9 items-center gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-bg text-fg-3">
                        <Icon name="key" size={13} />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{s.name}</span>
                      <span className="hidden shrink-0 font-num text-[12px] whitespace-nowrap text-fg-3 sm:inline" title={s.updated_at}>
                        {relTime(s.updated_at)}
                      </span>
                      <InlineConfirm tone="danger" label="Delete" confirmLabel="Delete" doneLabel="Deleted" busyLabel="Deleting" undoMs={5000} onConfirm={() => remove(s)} />
                    </div>
                    {deleteError?.key === key && (
                      <div className="pt-1 pb-1 pl-10 text-[12.5px] text-fg-2">
                        <StatusDot status="needs" size={7} className="mr-1.5" />
                        {deleteError.msg}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))
      )}

      <FootNote>
        Values live in {store}
        {status?.secretStore !== 'file' && (
          <>
            {' '}
            under the service <span className="font-mono text-[12px]">omni-os</span>
          </>
        )}
        . A thread gets them as environment variables when it runs. Sync credentials{status?.grokBot ? ' and the Grok Bot webhook' : ''} stay on the server, so a
        thread never sees them.
      </FootNote>
    </>
  );
}
