import type { HarnessWithRunning } from '../api.ts';
import { HarnessLogo, OmniMark } from '../components/brand.tsx';
import { modelOf, type ModelChoice } from '../components/ModelPicker.tsx';
import { AUTO_CHOICE, asksAuto } from '../thread-run.ts';
import { MoGroup, MoListRow, MoRadio, MoSection, MoSheet } from './parts.tsx';

/** What a run's chip reads: "Sonnet 5.5 · high", the model's default effort when none is picked. */
export function runLabel(harnesses: HarnessWithRunning[] | undefined, choice: ModelChoice, effort: string) {
  if (!harnesses) return 'Model';
  if (asksAuto(choice)) return 'Auto';
  const { harness, model } = modelOf(harnesses, choice);
  return [model?.label ?? harness?.name ?? choice.harness, effort || model?.defaultEffort].filter(Boolean).join(' · ');
}

/**
 * A new thread's model and effort, or a thread's run to switch, as a sheet: the desktop ModelPicker's list (each harness's models, a missing
 * harness with the command that fixes it) and the EffortPicker's levels. Picking a model resets effort to its default,
 * as on the desktop.
 */
export function ModelSheet({
  harnesses,
  choice,
  effort,
  onChange,
  onClose,
  offerAuto = true,
}: {
  harnesses: HarnessWithRunning[];
  choice: ModelChoice;
  effort: string;
  onChange: (choice: ModelChoice, effort: string) => void;
  onClose: () => void;
  /** List Auto first. A continued thread's run leaves it out, as the desktop ModelPicker does. */
  offerAuto?: boolean;
}) {
  const { model, efforts } = modelOf(harnesses, choice);
  return (
    <MoSheet full onClose={onClose} label="Model and effort">
      <div className="flex shrink-0 items-center px-3 pt-1.5 pb-2">
        <span className="w-[60px]" />
        <span className="flex-1 text-center text-[15px] font-medium">Model and effort</span>
        <button type="button" onClick={onClose} className="w-[60px] px-1.5 py-2 text-right text-[15px] font-medium">
          Done
        </button>
      </div>
      <div className="mo-scroll flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto pb-3">
        {offerAuto && (
          <MoSection title="Auto">
            <MoGroup>
              <MoListRow
                icon={<OmniMark size={20} />}
                label="Auto"
                sub="Picks the model and effort for your task"
                right={<MoRadio on={asksAuto(choice)} />}
                onClick={() => onChange(AUTO_CHOICE, '')}
                chevron={false}
                last
              />
            </MoGroup>
          </MoSection>
        )}
        {!asksAuto(choice) && efforts.length > 0 && (
          <MoSection title={`Effort for ${model?.label ?? 'this model'}`}>
            <MoGroup>
              {['', ...efforts].map((e, i, all) => (
                <MoListRow
                  key={e || 'default'}
                  label={e || (model?.defaultEffort ? `Default (${model.defaultEffort})` : 'Default')}
                  right={<MoRadio on={effort === e} />}
                  onClick={() => onChange(choice, e)}
                  chevron={false}
                  last={i === all.length - 1}
                />
              ))}
            </MoGroup>
          </MoSection>
        )}
        {harnesses.map((h) => (
          <MoSection key={h.id} title={h.name} right={<span className="text-[12px] text-fg-4">{h.available ? h.plan : 'Unavailable'}</span>}>
            <MoGroup>
              {h.available ? (
                h.models.map((m, i) => (
                  <MoListRow
                    key={m.id}
                    icon={
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-2 text-fg">
                        <HarnessLogo harness={h.id} size={13} />
                      </span>
                    }
                    label={
                      <>
                        {m.label}
                        {m.default && <span className="text-fg-4"> (default)</span>}
                      </>
                    }
                    sub={m.note || undefined}
                    right={<MoRadio on={h.id === choice.harness && m.id === choice.model} />}
                    onClick={() => onChange({ harness: h.id, model: m.id }, '')}
                    chevron={false}
                    last={i === h.models.length - 1}
                  />
                ))
              ) : (
                <MoListRow label="Not available" sub={h.fix || 'Install and log in on the Mac'} chevron={false} last />
              )}
            </MoGroup>
          </MoSection>
        ))}
      </div>
    </MoSheet>
  );
}
