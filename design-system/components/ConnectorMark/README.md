A connector's tile: the brand mark of the app an MCP or claude.ai connector call reaches, on a small rounded square, the way Claude's apps mark a connector. It replaces the raw tool name (`mcp__claude_ai_Granola__search_meetings`) with the app ("Granola") and what the call does in words ("Search meetings").

The mapping lives in `packages/shared/connectors.ts` (`connectorOf`, `connectorAction`, `connectorsUsed`): Gmail, Google Calendar, Drive, Docs, Sheets, Slides, Analytics, Notion, Slack, Linear, Figma, GitHub, Shopify, Vercel, Supabase, Atlassian and more wear their mark from `packages/shared/link-icons.ts` (simple-icons, the marks are their owners' trademarks). A known brand with no mark to draw (Granola, Productive, Klaviyo) wears its initial. Omni's own servers (`omni`, `omni-ask`, `omni-steps`, `omni-render`, `omni-threads`) wear the Omni ring. A server Omni does not know wears a neutral plug and its server name tidied ("acme_crm" is "Acme crm"). The browser servers and built-in tools (shell, file edits, search) are not connectors and keep their icons.

The tile: `--surface` ground, an inset 1px `--line-strong` edge, `--r-xs` corners; the mark fills 62% of it. Marks too dark or too light for both themes draw in `--fg`; the rest keep their brand colour. Sizes: 14px on a Details chip, 15px in the step line, 16px in a step's action row, 20px in the quick card, 24px in the inline row (26px on the phone).

Where it shows, on desktop web, phone web and the desktop app:
- **Inline row** (`ConnectorRow`, `MoConnectors` on the phone): one per outside connector per tool group, in the transcript. "Working on it" with the loader while one of its calls runs, then "Used Granola" and the call's action, or "N calls". The chevron opens the call's input and output (one call) or a branded row per call. A failure shows the needs dot and "error" or "N failed".
- **Step line** (`NowWithConnector`): the active step of the Steps and Progress cards reads "Now: [tile] Using Granola" while a connector call runs.
- **Connectors list** in the quick card: caption "Connectors", a row per outside connector the thread used (tile, name, muted "Connector", or "In use" with the loader while a call runs). Omni's own servers are left out: every thread has them.
- **Action rows** in a step's actions and the phone Actions screen: the tile and app name in place of the tool name, the action in words, not monospace.

```jsx
<ConnectorMark connector={connectorOf(call.name)} size={24} />
<ConnectorRow g={group} running={turnRunning} />
<NowWithConnector now="Using Granola" connector={step.connector} />
```
