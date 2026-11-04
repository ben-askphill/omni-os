/**
 * Model pill (web/src ModelPicker.tsx, Mac ModelPickerButton). The Picker's 32px pill with the harness logo in a 24px
 * disc and "· Harness" after the model; opens a 340px card with one search across harnesses, Auto first, then each
 * harness's models under a sticky header naming its plan ("Bills your Max plan"). The harness default reads
 * "(default)". A harness that is not installed or logged in shows "Not available. Run `cursor-agent login`."
 * In a thread's reply composer it leaves out Auto (`offerAuto={false}`) and opens upward. A pick there switches the
 * thread's run; during a turn the pick waits for the turn to end: both pills show it `queued` (ringed in live) after a
 * `NextTurnChip`, whose click keeps the current run.
 * On the phone the same choice lives in the composer's + sheet (Model and Effort rows), with a "Next turn" chip over
 * the composer while a switch waits.
 * @startingPoint section="Forms" subtitle="Model and effort pills with grouped harness list" viewport="760x560"
 */
export interface ModelChoice {
  /** 'auto' for Auto, else a harness id. */
  harness: string;
  /** '' for the harness default. */
  model: string;
}
export interface PickerModel {
  id: string;
  label: string;
  note?: string;
  default?: boolean;
  efforts?: string[];
  defaultEffort?: string;
}
export interface PickerHarness {
  id: 'claude-code' | 'codex' | 'cursor' | string;
  name: string;
  /** "Max plan" reads "Bills your Max plan"; anything else shows as given. */
  plan: string;
  available?: boolean;
  /** The command or sentence that makes it available. */
  fix?: string;
  models: PickerModel[];
}
export interface ModelPickerProps {
  harnesses: PickerHarness[];
  value: ModelChoice;
  onChange?: (v: ModelChoice) => void;
  /** Fires as the list opens, so the caller can refetch logins. */
  onOpen?: () => void;
  defaultOpen?: boolean;
  placeholder?: string;
  /** List Auto first. A thread's own pill leaves it out. */
  offerAuto?: boolean;
  /** Pill label in place of the model's name (a thread Auto started reads "Auto · Sonnet 5.5"). */
  label?: string;
  disabled?: boolean;
  /** Tooltip while disabled, e.g. "Switching". */
  disabledHelp?: string;
  /** The value is a switch queued for after this turn: ringed in live. */
  queued?: boolean;
  /** Force the card to open upward. */
  up?: boolean;
}
export function ModelPicker(props: ModelPickerProps): JSX.Element;

export interface EffortPickerProps {
  harnesses: PickerHarness[];
  choice: ModelChoice;
  /** '' for the model's default effort. */
  value: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  /** As on ModelPicker. */
  queued?: boolean;
  up?: boolean;
}
/** Effort pill: "Default (high)" plus the model's levels, or a disabled "Auto effort" when the model has none. */
export function EffortPicker(props: EffortPickerProps): JSX.Element;

export interface NextTurnChipProps {
  /** The run the thread is on now, named: "Sonnet 5.5, high". */
  now: string;
  /** Drop the queued switch: the thread keeps its run. */
  onKeep?: () => void;
  disabled?: boolean;
}
/** "Next turn ×" in live text on a 32px surface-2 pill, ahead of queued model and effort pills. */
export function NextTurnChip(props: NextTurnChipProps): JSX.Element;
