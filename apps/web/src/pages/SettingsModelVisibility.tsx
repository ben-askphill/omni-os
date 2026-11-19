import { useMemo, useState } from 'react';
import { api, errorText, useApi, type HarnessWithRunning } from '../api.ts';
import { HarnessLogo } from '../components/brand.tsx';
import { Button, ErrorNote, Icon, Loading, Segmented, Toggle } from '../components/ui.tsx';
import {
  DEFAULT_NEW_MODELS,
  hiddenModelIds,
  modelOverride,
  ruleShows,
  setNewModels,
  toggleModel,
  type HarnessModelPrefs,
  type ModelVisibility,
  type NewModelPolicy,
} from '@omni/shared/model-visibility.ts';
import { Card, Origin, ResetButton, SettingRow } from './settings-parts.tsx';

// Settings, Models: which models each harness's picker lists (packages/shared/model-visibility.ts). Saved on
// every switch, and synced to Ben's other machines. Hidden models still run wherever something already names them.

/** Past this many models, the list gets a search field. */
const SEARCH_FROM = 12;

const POLICY_OPTIONS: { id: NewModelPolicy; label: string }[] = [
  { id: 'latest', label: 'Newest of each family' },
  { id: 'all', label: 'All' },
];

const POLICY_HINT: Record<NewModelPolicy, string> = {
  latest: 'A new model shows, and the version it replaces drops out unless you switched that one on.',
  all: 'Every model the harness reports shows until you switch it off.',
};

export function ModelVisibilityCard() {
  const harnesses = useApi<HarnessWithRunning[]>('/harnesses');
  const prefs = useApi<ModelVisibility>('/model-visibility');
  const [tab, setTab] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<'check' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<string | null>(null);

  // A harness with one model (Hermes) has nothing to choose.
  const choosable = (harnesses.data ?? []).filter((h) => h.models.length > 1);
  const current = choosable.find((h) => h.id === tab) ?? choosable[0];
  const mine = current ? prefs.data?.[current.id] : undefined;
  const policy = mine?.newModels ?? DEFAULT_NEW_MODELS;
  const rule = useMemo(() => (current ? ruleShows(current.models, policy) : new Set<string>()), [current, policy]);
  // From the saved prefs, so a switch moves at once; the server marks the same models on GET /harnesses.
  const hidden = useMemo(() => (current ? hiddenModelIds(current.models, mine) : new Set<string>()), [current, mine]);

  const save = async (next: HarnessModelPrefs) => {
    if (!current) return;
    setBusy('save');
    setError(null);
    try {
      prefs.setData(await api.put<ModelVisibility>(`/model-visibility/${encodeURIComponent(current.id)}`, next));
      harnesses.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const check = async () => {
    setBusy('check');
    setError(null);
    setChecked(null);
    const before = new Set((harnesses.data ?? []).flatMap((h) => h.models.map((m) => `${h.id}/${m.id}`)));
    try {
      const fresh = await api.post<HarnessWithRunning[]>('/harnesses/refresh');
      harnesses.setData(fresh);
      const added = fresh.flatMap((h) => h.models.filter((m) => !before.has(`${h.id}/${m.id}`)).map((m) => m.label));
      setChecked(added.length ? `New: ${added.join(', ')}` : 'No new models');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const s = q.trim().toLowerCase();
  const models = current ? (s ? current.models.filter((m) => `${m.label} ${m.id}`.toLowerCase().includes(s)) : current.models) : [];
  const shown = current ? current.models.length - hidden.size : 0;
  const edited = !!mine && Object.keys(mine).length > 0;

  return (
    <Card
      entry="model-visibility"
      title="Models in the picker"
      subtitle="Omni asks each harness for its models, so a new one shows up without an update. Hidden models still run where a thread, crew role, channel or automation already uses one, and Auto still picks from all of them."
      actions={
        <>
          {checked && <span className="text-[12.5px] text-fg-3">{checked}</span>}
          <Button size="sm" variant="secondary" icon="refresh" busy={busy === 'check'} disabled={!!busy} onClick={() => void check()}>
            Check for new models
          </Button>
        </>
      }
    >
      {harnesses.error || prefs.error ? (
        <ErrorNote
          onRetry={() => {
            harnesses.reload();
            prefs.reload();
          }}
        >
          {harnesses.error ?? prefs.error}
        </ErrorNote>
      ) : !harnesses.data || !prefs.data ? (
        <Loading />
      ) : !current ? (
        <p className="text-[12.5px] text-fg-3">No harness lists more than one model yet.</p>
      ) : (
        <>
          <div className="scroll-thin -mx-1 overflow-x-auto px-1">
            <Segmented
              label="Harness"
              size="sm"
              value={current.id}
              onChange={(id) => {
                setTab(id);
                setQ('');
              }}
              options={choosable.map((h) => ({ id: h.id, label: h.name, badge: <span className="text-fg-3">{h.models.length - hiddenModelIds(h.models, prefs.data?.[h.id]).size}</span> }))}
            />
          </div>
          <SettingRow
            label="Models nobody switched"
            hint={POLICY_HINT[policy]}
            control={<Segmented radio size="sm" label="Models nobody switched" value={policy} onChange={(p) => void save(setNewModels(mine, current.models, p))} options={POLICY_OPTIONS} />}
          />
          <div className="flex min-h-7 flex-wrap items-center gap-2 text-[12.5px] text-fg-3">
            <HarnessLogo harness={current.id} size={13} />
            <span className="min-w-0 flex-1">
              {shown} of {current.models.length} shown in the picker
            </span>
            <Origin of={edited ? 'machine' : 'default'} label={edited ? 'Changed' : 'Built-in default'} title="Synced to your other machines" />
            <ResetButton of={edited ? 'machine' : 'default'} busy={busy === 'save'} onReset={() => void save({})} />
          </div>
          {current.models.length > SEARCH_FROM && (
            <label className="flex h-9 items-center gap-2 rounded-xl bg-bg px-3 text-fg-3">
              <Icon name="search" size={14} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Find a ${current.name} model`}
                aria-label={`Find a ${current.name} model`}
                className="field-sm h-full min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-4"
              />
            </label>
          )}
          <ul aria-label={`${current.name} models`} className="scroll-thin max-h-[440px] divide-y divide-line overflow-y-auto">
            {models.map((m) => {
              const override = modelOverride(m.id, mine);
              const why = override === 'shown' ? 'Switched on' : override === 'hidden' ? 'Switched off' : !rule.has(m.id) ? 'Older version' : null;
              return (
                <li key={m.id} className="flex min-w-0 items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">
                      {m.label}
                      {m.default && <span className="text-fg-3"> (default)</span>}
                    </div>
                    <div className="flex min-w-0 items-center gap-2 text-[11.5px] text-fg-3">
                      <code className="truncate">{m.id}</code>
                      {why && <span className="shrink-0">· {why}</span>}
                    </div>
                  </div>
                  <Toggle
                    checked={!hidden.has(m.id)}
                    disabled={busy === 'save'}
                    label={`Show ${m.label} in the picker`}
                    onChange={(on) => void save(toggleModel(mine, current.models, m.id, on))}
                  />
                </li>
              );
            })}
            {!models.length && <li className="py-2 text-[12.5px] text-fg-3">No match</li>}
          </ul>
          {error && <ErrorNote>{error}</ErrorNote>}
        </>
      )}
    </Card>
  );
}
