import type { SetupState, UserConfigPatch } from '@omni/client-core';
import { pageFields, settingHint, settingId, settingPlaceholder, settingProblem, type SettingField, type SettingPage } from '@omni/shared/settings.ts';

/**
 * One config field as the phone shows it. The fields come from the shared contract (@omni/shared/settings.ts), the same
 * one the Web UI's Settings page draws, so a new field shows here with no change. The phone edits text, not folders: a
 * folder is a path on the server's machine, which the phone cannot browse.
 */
export interface ConfigRow {
  field: SettingField;
  id: string;
  label: string;
  hint: string | null;
  placeholder: string;
  editable: boolean;
  /** Where the value comes from: "Set by OMNI_TZ", "Set on this machine" or "Built-in default". */
  origin: string;
  /** What a field the phone cannot edit shows. */
  shown: string;
}

export const editableOnPhone = (f: SettingField) => !f.readonly && f.input !== 'folder';

const saved = (f: SettingField, state: SetupState) => (state.config[f.section] as Record<string, string | undefined>)[f.key] ?? '';

function origin(f: SettingField, state: SetupState): string {
  const env = state.env?.[settingId(f)];
  if (env) return `Set by ${env}`;
  const v = saved(f, state);
  return v && v !== f.default ? 'Set on this machine' : 'Built-in default';
}

/** The resolved value a folder shows when none is saved: its machine default. */
function resolvedFolder(f: SettingField, state: SetupState): string {
  if (f.key === 'root') return state.resolved.workspaceRoot;
  if (f.key === 'reposDir') return state.resolved.reposDir;
  if (f.key === 'centralBrainDir') return state.resolved.centralBrainDir;
  return '';
}

export function configRows(page: SettingPage, state: SetupState): ConfigRow[] {
  return pageFields(page).map((f) => {
    const value = saved(f, state);
    return {
      field: f,
      id: settingId(f),
      label: f.label,
      hint: settingHint(f, state.fallbacks) ?? null,
      placeholder: settingPlaceholder(f, state.fallbacks),
      editable: editableOnPhone(f),
      origin: origin(f, state),
      shown: value || resolvedFolder(f, state) || 'Not set',
    };
  });
}

/** The editable fields' values as the form starts: saved, else the default. */
export function configValues(rows: readonly ConfigRow[], state: SetupState): Record<string, string> {
  return Object.fromEntries(rows.filter((r) => r.editable).map((r) => [r.id, saved(r.field, state) || r.field.default]));
}

/** The first refused value's message, checked as the Web UI's form checks it. */
export function configProblem(rows: readonly ConfigRow[], values: Record<string, string>): string | null {
  for (const r of rows) if (r.editable) {
    const problem = settingProblem(r.field, values[r.id] ?? '', 'form');
    if (problem) return problem;
  }
  return null;
}

/** PUT /setup's body: the editable fields only, trimmed, an empty one with a default (pronouns) back to it. */
export function configPatch(rows: readonly ConfigRow[], values: Record<string, string>): UserConfigPatch {
  const patch: Record<string, Record<string, string>> = {};
  for (const r of rows) if (r.editable) (patch[r.field.section] ??= {})[r.field.key] = (values[r.id] ?? '').trim() || r.field.default;
  return patch as UserConfigPatch;
}

export const configDirty = (rows: readonly ConfigRow[], values: Record<string, string>, state: SetupState) =>
  JSON.stringify(configPatch(rows, values)) !== JSON.stringify(configPatch(rows, configValues(rows, state)));
