import type { InputHTMLAttributes } from 'react';

/**
 * Field from web/src index.css `.field`: surface fill, 1px inset line, 14px radius, 40px tall; focus lifts to white
 * with a 4px wash ring. Errors get a vermilion edge + diamond; the message stays ink.
 */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  mono?: boolean;
}
export function Input(props: InputProps): JSX.Element;
