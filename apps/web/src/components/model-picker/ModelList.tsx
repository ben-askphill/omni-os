import type { RefObject } from 'react';
import type { HarnessWithRunning } from '../../api.ts';
import type { PickerAccounts } from '../../accounts.ts';
import { accountLine } from '@omni/shared/harness-accounts.ts';
import { AUTO_CHOICE } from '@omni/shared/thread-run.ts';
import { HarnessLogo } from '../brand.tsx';
import { Icon } from '../ui.tsx';
import type { ModelChoice } from '../ModelPicker.tsx';

const AUTO_NOTE = 'Picks a model for each task';

type Groups = { harness: HarnessWithRunning; models: HarnessWithRunning['models'] }[];

/** The pickable options in the order the list shows them: Auto, then each available harness's models. */
export function listedChoices(groups: Groups, showAuto: boolean): ModelChoice[] {
  const models = groups.flatMap(({ harness, models }) => (harness.available ? models.map((m) => ({ harness: harness.id, model: m.id })) : []));
  return showAuto ? [AUTO_CHOICE, ...models] : models;
}

/**
 * The open picker's list: Auto first when offered, then each harness with the models that match the search. Each
 * harness is a group labelled by its sticky header; its notes (not available, no match) sit in the group, outside the
 * options. Options are numbered as `listedChoices` lists them, for the cursor.
 */
export function ModelList({
  groups,
  showAuto,
  auto,
  value,
  query,
  onPick,
  accounts,
  listId,
  optionId,
  cursor,
  onHover,
  scroller,
}: {
  groups: Groups;
  showAuto: boolean;
  auto: boolean;
  value: ModelChoice;
  query: string;
  onPick: (v: ModelChoice) => void;
  /** Who each harness runs as on the machine the thread runs on. Its header names the account instead of the plan. */
  accounts?: PickerAccounts | null;
  listId: string;
  optionId: (i: number) => string;
  /** The option under the cursor, as numbered by `listedChoices`. */
  cursor: number;
  onHover: (i: number) => void;
  /** The scrolling box, kept scrolled to the cursor. */
  scroller: RefObject<HTMLDivElement | null>;
}) {
  const pick = onPick;
  let n = 0;
  const option = () => {
    const i = n++;
    return { id: optionId(i), tabIndex: -1, 'data-cursor': i === cursor, onMouseMove: () => onHover(i) };
  };
  return (
    <div ref={scroller} className="scroll-thin max-h-[320px] overflow-y-auto">
      {accounts && !accounts.current && <div className="px-3 pt-2 text-[11.5px] text-fg-3">Accounts on {accounts.machine}</div>}
      <div id={listId} role="listbox" aria-label="Model">
        {showAuto && (
          <button type="button" role="option" aria-selected={auto} {...option()} onClick={() => pick(AUTO_CHOICE)} className="pik-row">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-fg">
              <Icon name="zap" size={13} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] text-fg">Auto</span>
              <span className="truncate text-[11.5px] text-fg-3">{AUTO_NOTE}</span>
            </span>
            <span className="pik-mark">{auto && <Icon name="check" size={12} strokeWidth={2.6} />}</span>
          </button>
        )}
        {groups.map(({ harness, models }) => {
          const plan = harness.plan.endsWith('plan') ? `Bills your ${harness.plan}` : harness.plan;
          const account = harness.available ? accounts?.byHarness[harness.id] : undefined;
          const head = `${listId}-${harness.id}`;
          return (
            <div key={harness.id} role="group" aria-labelledby={head}>
              <div id={head} className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-elev px-3 pt-2 pb-1">
                <span className="caption flex shrink-0 items-center gap-1.5">
                  <HarnessLogo harness={harness.id} size={12} />
                  <span className="truncate">{harness.name}</span>
                </span>
                {account ? (
                  <span
                    title={`${plan}. Signed in on ${accounts!.machine}${account.notice ? ': switched since you last looked' : ''}`}
                    className={`flex min-w-0 items-center gap-1 text-[11.5px] ${account.notice ? 'text-warn' : 'text-fg-3'}`}
                  >
                    {account.notice && <Icon name="alert" size={11} className="shrink-0" />}
                    <span className="truncate">{accountLine(account)}</span>
                  </span>
                ) : (
                  <span className="shrink-0 text-[11.5px] text-fg-3">{harness.available ? plan : 'Unavailable'}</span>
                )}
              </div>
              {!harness.available ? (
                <div className="px-3 pb-2 text-[11.5px] text-fg-3">
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
                    {...option()}
                    onClick={() => pick({ harness: harness.id, model: m.id })}
                    // Scrolled to below the sticky header, not under it.
                    className="pik-row scroll-mt-8"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-fg">
                      <HarnessLogo harness={harness.id} size={13} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px] text-fg">
                        {m.label}
                        {m.default && <span className="text-fg-3"> (default)</span>}
                      </span>
                      {m.note && <span className="truncate text-[11.5px] text-fg-3">{m.note}</span>}
                    </span>
                    <span className="pik-mark">
                      {harness.id === value.harness && m.id === value.model && <Icon name="check" size={12} strokeWidth={2.6} />}
                    </span>
                  </button>
                ))
              ) : query.trim() ? (
                <div className="px-3 pb-2 text-[11.5px] text-fg-3">No match</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
