import { OptionGroup, OptionRow } from '../../ui/OptionRow';
import type { RunSheetModel } from '../../thread/run-model';

interface RunOptionsProps {
  model: RunSheetModel;
  disabled: boolean;
  onEffort: (effort: string) => void;
  onModel: (harness: string, model: string) => void;
  /** A first group with one row, for a start that can leave the choice to Auto. */
  auto?: { selected: boolean; onPress: () => void };
}

/** Shared by a thread's run switch and the new-thread sheet. */
export function RunOptions({ model, disabled, onEffort, onModel, auto }: RunOptionsProps) {
  return (
    <>
      {auto ? (
        <OptionGroup>
          <OptionRow
            label="Auto"
            sub="Picks the model and effort for the prompt"
            selected={auto.selected}
            disabled={disabled}
            onPress={auto.onPress}
            last
          />
        </OptionGroup>
      ) : null}
      {model.effortTitle ? (
        <OptionGroup title={model.effortTitle}>
          {model.efforts.map((e, i) => (
            <OptionRow
              key={e.value || 'default'}
              label={e.label}
              selected={e.selected}
              disabled={disabled}
              onPress={() => onEffort(e.value)}
              last={i === model.efforts.length - 1}
            />
          ))}
        </OptionGroup>
      ) : null}
      {model.harnesses.map((h) => (
        <OptionGroup key={h.id} title={h.name} trailing={h.plan}>
          {h.available ? (
            h.models.map((m, i) => (
              <OptionRow
                key={m.id}
                label={m.label}
                sub={m.note}
                selected={m.selected}
                disabled={disabled}
                onPress={() => onModel(h.id, m.id)}
                last={i === h.models.length - 1}
              />
            ))
          ) : (
            <OptionRow label="Not available" sub={h.fix || 'Install and log in on the machine Omni runs on'} last />
          )}
        </OptionGroup>
      ))}
    </>
  );
}
