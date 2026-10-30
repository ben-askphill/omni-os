import type { HarnessWithRunning } from '../../api.ts';
import { AUTO_CHOICE } from '../../thread-run.ts';
import { HarnessLogo } from '../brand.tsx';
import { Icon } from '../ui.tsx';
import type { ModelChoice } from '../ModelPicker.tsx';

const AUTO_NOTE = 'Picks a model for each task';

/** The open picker's list: Auto first when offered, then each harness with the models that match the search. */
export function ModelList({
  groups,
  showAuto,
  auto,
  value,
  query,
  onPick,
}: {
  groups: { harness: HarnessWithRunning; models: HarnessWithRunning['models'] }[];
  showAuto: boolean;
  auto: boolean;
  value: ModelChoice;
  query: string;
  onPick: (v: ModelChoice) => void;
}) {
  const pick = onPick;
  return (
    <div role="listbox" aria-label="Model" className="scroll-thin max-h-[320px] overflow-y-auto outline-none">
      {showAuto && (
        <button type="button" role="option" aria-selected={auto} onClick={() => pick(AUTO_CHOICE)} className="pik-row">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-fg">
            <Icon name="zap" size={13} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] text-fg">Auto</span>
            <span className="truncate text-[11.5px] text-fg-4">{AUTO_NOTE}</span>
          </span>
          <span className="pik-mark">{auto && <Icon name="check" size={12} strokeWidth={2.6} />}</span>
        </button>
      )}
      {groups.map(({ harness, models }) => (
        <div key={harness.id}>
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-elev px-3 pt-2 pb-1">
            <span className="caption flex min-w-0 items-center gap-1.5">
              <HarnessLogo harness={harness.id} size={12} />
              <span className="truncate">{harness.name}</span>
            </span>
            <span className="shrink-0 text-[11.5px] text-fg-4">
              {harness.available ? (harness.plan.endsWith('plan') ? `Bills your ${harness.plan}` : harness.plan) : 'Unavailable'}
            </span>
          </div>
          {!harness.available ? (
            <div className="px-3 pb-2 text-[11.5px] text-fg-4">
              {harness.fix && harness.fix.split(/\s+/).length <= 3 ? (
                <>
                  Not available. Run <code className="font-mono text-fg-2">{harness.fix}</code>.
                </>
              ) : (
                <>Not available. {harness.fix}</>
              )}
            </div>
          ) : models.length ? (
            models.map((m) => (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={harness.id === value.harness && m.id === value.model}
                onClick={() => pick({ harness: harness.id, model: m.id })}
                className="pik-row"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-fg">
                  <HarnessLogo harness={harness.id} size={13} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] text-fg">
                    {m.label}
                    {m.default && <span className="text-fg-4"> (default)</span>}
                  </span>
                  {m.note && <span className="truncate text-[11.5px] text-fg-4">{m.note}</span>}
                </span>
                <span className="pik-mark">
                  {harness.id === value.harness && m.id === value.model && <Icon name="check" size={12} strokeWidth={2.6} />}
                </span>
              </button>
            ))
          ) : query.trim() ? (
            <div className="px-3 pb-2 text-[11.5px] text-fg-4">No match</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
