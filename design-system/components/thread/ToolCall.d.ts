import type { ReactNode } from 'react';

/**
 * Tool calls (web/src Transcript.tsx). ToolCall: 32px pill row (caret · icon · name · mono args · duration/loader/error)
 * with a hover wash; opens to a 12px-radius mono pre. ToolCalls: groups 2+ calls in a 20px-radius surface card with a
 * 40px "N tool calls · names" header that expands. The caret rotates with the settle spring.
 */
export interface ToolCallProps {
  name: string;
  args?: string;
  status?: 'running' | 'done' | 'failed';
  duration?: string;
  output?: string;
  defaultOpen?: boolean;
}
export function ToolCall(props: ToolCallProps): JSX.Element;
export function ToolCalls(props: { children?: ReactNode; defaultOpen?: boolean; live?: boolean }): JSX.Element;
