/** Enough of the harness catalog to name a thread's model and effort. */
export interface RunCatalogModel {
  id: string;
  label: string;
  efforts: string[];
  /** Empty when the model has no levels. */
  defaultEffort: string;
  default?: boolean;
}

export interface RunCatalogHarness {
  id: string;
  name: string;
  models: RunCatalogModel[];
}

export interface ThreadRunLabels {
  /** The model's display name, the stored id, or "default". */
  model: string;
  /** The harness's display name. Empty until the catalog names it. */
  harnessName: string;
  /** The chosen level, "Default (x)", "Auto effort", or "default". */
  effort: string;
}

/**
 * What the reply composer shows for a thread. Model and effort are fixed once a thread starts,
 * so this only names them. An empty model is the harness default. An empty effort is that model's default.
 */
export function threadRunLabels(
  thread: { harness: string; model: string | null; effort: string },
  harnesses: RunCatalogHarness[] | null | undefined,
): ThreadRunLabels {
  const harness = harnesses?.find((h) => h.id === thread.harness);
  const picked = thread.model ? harness?.models.find((m) => m.id === thread.model) : undefined;
  const model = picked ?? (thread.model ? undefined : harness?.models.find((m) => m.default) ?? harness?.models[0]);
  return {
    model: model?.label || thread.model || 'default',
    harnessName: harness?.name ?? '',
    effort: effortLabel(thread.effort, model, !!harness),
  };
}

function effortLabel(effort: string, model: RunCatalogModel | undefined, catalogKnown: boolean): string {
  if (!catalogKnown || !model) return effort || 'default';
  if (model.efforts.length === 0) return 'Auto effort';
  if (effort) return effort;
  if (model.defaultEffort) return `Default (${model.defaultEffort})`;
  return 'Default';
}
