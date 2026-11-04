/**
 * Composer (web/src Composer.tsx): 26px-radius surface shell (30px + 16px text when `big`), focus lifts to white
 * with a 4px wash ring. 60px textarea at 14.5. Bottom bar: Bencho pickers for crew role, channel and harness,
 * an attach icon button, and a round ink send button.
 * @startingPoint section="Thread" subtitle="Composer with role / channel / harness pickers" viewport="760x220"
 */
export interface ComposerProps {
  placeholder?: string;
  role?: 'conductor' | 'researcher' | 'builder' | 'store-ops' | 'inbox';
  channel?: { code?: string; name: string };
  channels?: { code?: string; name: string }[];
  harness?: 'claude-code' | 'codex' | 'cursor';
  model?: string;
  onSend?: (text: string) => void;
  hints?: boolean;
  big?: boolean;
  value?: string;
  onChange?: (v: string) => void;
  /** Open picker cards upwards (default true, composer sits at the bottom) */
  up?: boolean;
}
export function Composer(props: ComposerProps): JSX.Element;
