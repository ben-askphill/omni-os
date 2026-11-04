/** Liquid toggle (Bencho, web/src ui.tsx): 38×22 pill, knob widens on press and settles across with a spring. On = ink. */
export interface ToggleProps {
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}
export function Toggle(props: ToggleProps): JSX.Element;
