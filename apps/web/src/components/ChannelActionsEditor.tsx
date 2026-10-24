import { useState, type FormEvent } from 'react';
import type { ChannelAction } from '@omni/shared/channel-actions.ts';
import { api, errorText, useApi } from '../api.ts';
import { actionInput, draftOf, type ActionDraft, type PortMode } from '../channel-actions.ts';
import { href } from '../router.ts';
import { ActionLine } from './thread/panel/ActionsTab.tsx';
import { Button, Chip, ErrorNote, InlineConfirm, Label, Loading, Segmented } from './ui.tsx';

/** Editing a new action rather than one in the list. */
const NEW = '';

/**
 * A channel's named actions, each saved on its own as soon as Ben saves it, not with the channel form's Save. Threads
 * in the channel run them from their Actions tab.
 */
export function ChannelActionsEditor({ channelId }: { channelId: string }) {
  const path = `/channels/${encodeURIComponent(channelId)}/actions`;
  const { data, error, reload, setData } = useApi<ChannelAction[]>(path);
  // An action's id, NEW, or null while nothing is open.
  const [editing, setEditing] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const saved = (a: ChannelAction) => {
    setData((list = []) => (list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a]));
    setEditing(null);
  };

  const remove = async (a: ChannelAction) => {
    setDeleteError(null);
    try {
      await api.del(`${path}/${encodeURIComponent(a.id)}`);
      setData((list = []) => list.filter((x) => x.id !== a.id));
    } catch (e) {
      setDeleteError(errorText(e));
      throw e;
    }
  };

  if (!data) return error ? <ErrorNote onRetry={reload}>{error}</ErrorNote> : <Loading label="Loading actions" />;

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-fg-3">Commands a thread here can run from its Actions tab, like a theme preview, a theme check or the tests. Each one is saved on its own.</p>
      {data.map((a) =>
        editing === a.id ? (
          <ActionForm key={a.id} path={path} action={a} onSaved={saved} onCancel={() => setEditing(null)} />
        ) : (
          <div key={a.id} className="rounded-[18px] bg-surface px-4 py-3">
            <ActionLine action={a} />
            <div className="flex flex-wrap items-center gap-1.5 pt-2">
              {a.secrets.map((s) => (
                <Chip key={s} tone="outline" className="font-mono" title="A secret this action reads">
                  {s}
                </Chip>
              ))}
              <span className="ml-auto flex items-center gap-1.5">
                <Button size="sm" variant="ghost" icon="pencil" onClick={() => setEditing(a.id)}>
                  Edit
                </Button>
                <InlineConfirm label="Delete" icon="trash" confirmLabel="Delete" busyLabel="Deleting" onConfirm={() => remove(a)} />
              </span>
            </div>
          </div>
        ),
      )}
      {deleteError && <ErrorNote>{deleteError}</ErrorNote>}
      {editing === NEW ? (
        <ActionForm path={path} onSaved={saved} onCancel={() => setEditing(null)} />
      ) : (
        <Button icon="plus" onClick={() => setEditing(NEW)}>
          Add action
        </Button>
      )}
    </div>
  );
}

const PORT_HINT: Record<PortMode, string> = {
  none: 'The command serves nothing.',
  free: 'Omni picks a free port each run, so two threads can preview at once. The command reads it as $OMNI_PORT.',
  fixed: 'Always this port. A second run while it is taken is refused.',
};

function ActionForm({ path, action, onSaved, onCancel }: { path: string; action?: ChannelAction; onSaved: (a: ChannelAction) => void; onCancel: () => void }) {
  const [d, setD] = useState<ActionDraft>(() => draftOf(action));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ActionDraft>(k: K, v: ActionDraft[K]) => setD((prev) => ({ ...prev, [k]: v }));
  const id = action?.id ?? 'new';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = actionInput(d);
    if ('error' in parsed) return setError(parsed.error);
    setBusy(true);
    setError(null);
    try {
      onSaved(
        action
          ? await api.patch<ChannelAction>(`${path}/${encodeURIComponent(action.id)}`, parsed.input)
          : await api.post<ChannelAction>(path, parsed.input),
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-[18px] p-4 shadow-[inset_0_0_0_1px_var(--line)]" autoComplete="off">
      <div>
        <Label htmlFor={`act-name-${id}`}>Name</Label>
        <input id={`act-name-${id}`} className="field" value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="Theme preview" autoFocus />
      </div>
      <div>
        <Label htmlFor={`act-cmd-${id}`} hint="Runs in the thread's checkout with your login shell. Use $OMNI_PORT for the preview port.">
          Command
        </Label>
        <textarea
          id={`act-cmd-${id}`}
          className="field min-h-[84px] resize-y font-mono !text-[13px]"
          value={d.command}
          onChange={(e) => set('command', e.target.value)}
          placeholder="shopify theme dev --port $OMNI_PORT"
          spellCheck={false}
        />
      </div>
      <div>
        <Label
          htmlFor={`act-secrets-${id}`}
          hint={
            <>
              Names only, separated by commas or spaces. The command reads each one as $NAME. Values stay in the Keychain under{' '}
              <a className="underline underline-offset-2" href={href.secrets()}>
                Secrets
              </a>
              . Billing and sync keys are refused.
            </>
          }
        >
          Secrets
        </Label>
        <input
          id={`act-secrets-${id}`}
          className="field font-mono !text-[13px]"
          value={d.secrets}
          onChange={(e) => set('secrets', e.target.value.toUpperCase())}
          placeholder="SHOPIFY_CLI_THEME_TOKEN"
          spellCheck={false}
        />
      </div>
      <div>
        <Label hint={PORT_HINT[d.portMode]}>Port</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            radio
            size="sm"
            label="Port"
            value={d.portMode}
            onChange={(m) => set('portMode', m)}
            options={[
              { id: 'none', label: 'None' },
              { id: 'free', label: 'Free port per run' },
              { id: 'fixed', label: 'Fixed' },
            ]}
          />
          {d.portMode === 'fixed' && (
            <input
              aria-label="Fixed port"
              className="field w-28 font-mono !text-[13px]"
              inputMode="numeric"
              value={d.port}
              onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))}
              placeholder="9292"
            />
          )}
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" busy={busy}>
          {action ? 'Save action' : 'Add action'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
