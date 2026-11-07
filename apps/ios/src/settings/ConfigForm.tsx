import type { SetupState } from '@omni/client-core';
import { SETTING_PAGES, type SettingPage } from '@omni/shared/settings.ts';
import { useEffect, useMemo, useState } from 'react';

import { useLiveHub } from '../live/react';
import { configDirty, configPatch, configProblem, configRows, configValues } from './config-model';
import { Group, InputRow, SaveRow } from './parts';

/**
 * One page of the server's config fields (data/omni.config.json), drawn from the shared contract as the Web UI's
 * Settings draws them, and saved through PUT /setup. A folder or a field only the file sets shows its value.
 */
export function ConfigForm({ page, state, onSaved, footer }: { page: SettingPage; state: SetupState; onSaved: (next: SetupState) => void; footer?: string }) {
  const hub = useLiveHub();
  const rows = useMemo(() => configRows(page, state), [page, state]);
  const [values, setValues] = useState(() => configValues(rows, state));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // A save on another device changes the file: take its values unless this form has edits.
  const dirty = configDirty(rows, values, state);
  useEffect(() => {
    if (!busy) setValues((cur) => (configDirty(rows, cur, state) ? cur : configValues(rows, state)));
  }, [rows, state, busy]);

  async function save() {
    const problem = configProblem(rows, values);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const next = await hub.request((api) => api.updateSetup(configPatch(rows, values)));
      setValues(configValues(configRows(page, next), next));
      onSaved(next);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const editable = rows.some((r) => r.editable);
  const info = SETTING_PAGES[page];
  return (
    <>
      <Group title={info.title} footer={footer ?? info.note}>
        {rows.map((r, i) => (
          <InputRow
            key={r.id}
            first={i === 0}
            label={r.label}
            origin={r.origin}
            hint={r.hint}
            placeholder={r.placeholder}
            readOnly={!r.editable}
            code={r.field.input === 'folder' || r.field.input === 'url' || r.field.input === 'owner'}
            keyboardType={r.field.input === 'email' ? 'email-address' : r.field.input === 'url' ? 'url' : undefined}
            autoCapitalize={r.field.input === 'text' ? 'words' : 'none'}
            value={r.editable ? (values[r.id] ?? '') : r.shown}
            onChangeText={(text) => {
              setSaved(false);
              setValues((cur) => ({ ...cur, [r.id]: text }));
            }}
          />
        ))}
      </Group>
      {editable ? <SaveRow busy={busy} disabled={!dirty} error={error} saved={saved && !dirty} onPress={() => void save()} /> : null}
    </>
  );
}
