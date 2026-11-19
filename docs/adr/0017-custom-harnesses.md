# Custom harnesses: remote agents the user registers

Omni had one remote agent of the user's own, Hermes: one URL in Settings and one global key, `HERMES_API_KEY` ([ADR 0003](0003-hermes-remote-harness.md)). A second server could not be added, the harness list was a fixed union of five ids, and a thread whose harness id Omni did not know ran on Claude Code (`adapterFor` fell back to it). Hermes's key also reached every local Claude Code, Codex and Cursor thread as an environment variable when it was set in Secrets. Slice B1 of Addendum A of the [user-defined crew plan](../plans/2026-11-18-user-defined-crew.md) opens the list. Ben took the addendum's recommendations E1 to E10.

## Decision

- **A custom harness is a file.** `data/harnesses/<slug>.yaml` holds a name, a kind, a URL, the name of the secret that holds its key, a `bills` note, a model family, a cap and capabilities it turns off. Its id is `custom:<slug>`, so it never clashes with a built-in or passes for one. The UI calls it a custom harness (E1).
- **One protocol first: the Runs API**, the HTTP shape Omni already speaks to Hermes, documented in [Remote harness protocol](../internals/remote-harness-protocol.md) (E2). Every custom harness runs on the Hermes adapter, under its own id. A file with another `kind` loads as unavailable until a build speaks it.
- **The file syncs; the key does not** (E3). Harness files travel as `harness_file`, a signed action entity: only a trusted machine's file applies, as with crew files. Each machine reads the key from its own secret store, and one without it shows the harness as unavailable and names the secret.
- **Hermes keeps its id** (E4). Its URL stays in Settings and its key in `HERMES_API_KEY`; it is the built-in Runs API entry, so existing threads keep running with no migration.
- **Keys are server-only.** A secret a harness file names, and `HERMES_API_KEY`, never reach a thread's environment, a terminal or a channel action, in any scope (`secrets.ts secretReachesThread`; `env-guard.ts` also strips Hermes's key from the server environment). The runner hands the key to that harness's HTTP client only (`AdapterContext.harnessKey`). A file cannot name one of Omni's own credentials, or any `OMNI_` name.
- **A remote agent gets nothing else** (E6, E7, E9): no channel or global secret, no install or thread token, no Omni tools, and no delegate-only role. Omni's prompt goes as `instructions`, else in the first message (E10).
- **Network rule** (E8): `https://`, or plain `http://` only to this machine or a Tailscale address. Redirects are never followed.
- **Capabilities instead of ids.** `HarnessCapabilities` gains `remote`, `toolLimits` and `switchable`. `isProviderHarness` reads `remote` (true for every custom id, file or not), the delegate-only and access-level refusals read `toolLimits`, and switching refuses a custom harness as it does Hermes. A file can turn `steer` and `interrupt` off, never on.
- **An unknown harness refuses.** A thread whose harness is a custom harness with no file here (deleted, or not synced yet), or an id no build knows, does not start: its messages wait, the thread says why, and nothing runs on another harness. A session already up checks again before each turn.
- **Only Ben writes one.** `POST`, `PUT` and `DELETE /api/harnesses/custom/:slug` refuse any agent thread and any credential but the install token or a session paired with it, as a shell does: a harness decides where briefs go and which secret is sent there.

## Considered

- **Hermes as a file, `custom:hermes`.** A rename would need a data migration of every thread's harness for no gain, and the Hermes URL would start syncing.
- **Per-machine harness config.** Every machine would need the same entry made by hand, and a role bound to it would break on the machine without one.
- **A2A first.** It has no usage and no tool-call events, so its threads would show less than Hermes's. It comes second (slice B6).
- **Leaving the key in the environment and stripping it per harness.** The strip lists are per harness id; a custom harness's key name is the user's own, so only a rule at the secret store keeps it out of every process.

## Not yet

B2 and later: an add form in Settings (the Connect an agent sheet), the role editor's warnings, the remote mark in pickers, a capabilities body on the probe, git and PR reporting, spend totals, scoped tools and approvals, A2A, and iOS.
