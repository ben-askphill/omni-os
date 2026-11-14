import type { HarnessWithRunning } from '../api.ts';
import type { PickerAccounts } from '../accounts.ts';
import { accountLine } from '@omni/shared/harness-accounts.ts';
import { Icon } from '../components/ui.tsx';
import { HarnessLogo, OmniMark } from '../components/brand.tsx';
import { modelOf, type ModelChoice } from '../components/ModelPicker.tsx';
import { AUTO_CHOICE, asksAuto } from '@omni/shared/thread-run.ts';
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
  accounts,
}: {
  harnesses: HarnessWithRunning[];
  choice: ModelChoice;
  effort: string;
  onChange: (choice: ModelChoice, effort: string) => void;
  onClose: () => void;
  /** List Auto first. A continued thread's run leaves it out, as the desktop ModelPicker does. */
  offerAuto?: boolean;
  /** Who each harness runs as on the machine the thread runs on: named in each harness's heading. */
  accounts?: PickerAccounts | null;
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
        {accounts && !accounts.current && <p className="m-0 px-5 text-[12.5px] text-fg-3">Accounts on {accounts.machine}</p>}
        {harnesses.map((h) => {
          const account = h.available ? accounts?.byHarness[h.id] : undefined;
          return (
            <MoSection
              key={h.id}
              title={h.name}
              right={
                account ? (
                  <span className={`flex min-w-0 items-center gap-1 text-[12px] ${account.notice ? 'text-warn' : 'text-fg-3'}`}>
                    {account.notice && <Icon name="alert" size={11} className="shrink-0" />}
                    <span className="truncate">{accountLine(account)}</span>
                  </span>
                ) : (
                  <span className="text-[12px] text-fg-3">{h.available ? h.plan : 'Unavailable'}</span>
                )
              }
            >
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
                          {m.default && <span className="text-fg-3"> (default)</span>}
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
                  <MoListRow label="Not available" sub={h.fix || 'Install and log in on the machine Omni runs on'} chevron={false} last />
                )}
              </MoGroup>
            </MoSection>
          );
        })}
      </div>
    </MoSheet>
  );
}
