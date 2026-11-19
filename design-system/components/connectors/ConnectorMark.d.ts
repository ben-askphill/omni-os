/**
 * Connectors (apps/web/src/components/ConnectorMark.tsx, thread/ToolRows.tsx ConnectorRow, thread/ThreadQuickCard.tsx
 * Connectors). The brand data comes from packages/shared/connectors.ts.
 */
export type ConnectorMarkKind =
  | { type: 'logo'; icon: string } // a key of LINK_ICONS (packages/shared/link-icons.ts)
  | { type: 'omni' } // Omni's ring
  | { type: 'letter'; text: string } // a known brand with no mark
  | { type: 'generic' }; // a server Omni does not know: a plug

export interface Connector {
  /** `granola`, `google-calendar`, or `mcp:<server>` for an unknown one. */
  id: string;
  /** "Granola", "Google Calendar", "Acme crm". */
  name: string;
  mark: ConnectorMarkKind;
  kind: 'connector' | 'omni';
}

/** The tile, `size` px square (14 to 26), the mark at 62% of it. role="img", labelled with the name. */
export function ConnectorMark(props: { connector: Connector; size?: number; className?: string }): JSX.Element;

/** "Now: [tile] Using Granola". Without a connector, plain "Now: <now>". `prefix` "" drops "Now:". */
export function NowWithConnector(props: { now: string; connector?: Connector | null; prefix?: string }): JSX.Element;

/**
 * One outside connector's calls in a tool group, inline in the transcript: 24px tile, "Working on it" + loader while a
 * call runs, "Used <name>" + the action (or "N calls") after, chevron, opens to the call's input and output.
 */
export function ConnectorRow(props: { g: { connector: Connector; calls: unknown[] }; cwd?: string | null; running: boolean }): JSX.Element;
