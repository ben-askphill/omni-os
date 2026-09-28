# The Mac app is a SwiftUI client of the Node server, not a rewrite

The Mac app is a native SwiftUI app that talks to the same Omni server and `/api` as the Web UI, over HTTP and SSE on localhost. It does not replace the server. The runner, harness adapters, stream parser, database, Keychain handling, worktrees, automations and conductor MCP stay in Node. Ben's reason for a Mac app is the native feel at his desk. A Swift rewrite of the backend would bring no visible gain and would cost weeks of re-proving the harness contracts that the vitest suite already covers. It would also leave the phone, the conductor MCP, omni.sh and claude-bar without a server. A web view wrapper around the React UI was considered and rejected: it would not feel native, which was the whole point.

## Consequences

- Two clients render the same threads. A change to thread behavior in the Web UI (transcript, composer, slash menu) has to say whether the Mac app needs the same change.
- The slash grammar and menu ranking are not ported. The Mac app runs the same TypeScript modules through JavaScriptCore from a checked-in bundle, and a test fails when the bundle is stale. Those modules live in `shared/`, not `web/`: the two clients never import each other's code, and `tests/app-boundaries.test.ts` fails if either does. Stable presentation rules (transcript grouping, tool labels, status line, format helpers) are ported to Swift and pinned by tests that mirror the TypeScript ones.
- The Mac app needs Node and the repo checkout on the Mac. It can start the server from the repo, but it does not bundle either, so it is not distributable as is.
