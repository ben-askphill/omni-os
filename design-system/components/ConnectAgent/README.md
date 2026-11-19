ConnectAgent is the Connect an agent sheet in Settings > Models > Harnesses and the Harnesses step of setup, on desktop web, phone web and the desktop app (`ConnectAgentSheet` in `apps/web/src/components/ConnectAgent.tsx`), with the two small parts it adds: `CapabilityChips` and `RemoteMark`. It is composed of existing parts: `Modal` (roomy, a bottom sheet on the phone), `CheckItem`, `Chip`, `Label`, `.field`, `Picker`, `Toggle`, `CopyButton`, `ErrorNote` and `ModalFooter`.

```jsx
<ConnectAgentSheet open initial="omni://connect-agent?url=…&code=…" onClose={close} onConnected={reload} />
<CapabilityChips can={['Steer', 'Stop', 'Tool rows', 'Token counts']} cannot={['Worktree', 'Browser', 'Omni tools']} />
<RemoteMark host="hermes.tail1234.ts.net:8642" />   // "Remote · host", outlined
```

## The sheet

- A one-line blurb, then the three steps as `CheckItem`s in a row: **Find**, **Sign in**, **Test** (pending, in progress, completed).
- **Find**: one field, "Agent address, link or code", with **Find**; a Pairing code field under it when the text holds no code. Before anything is found, a quiet `bg` box offers the Hermes helper's command with Copy.
- **Found**: a `bg` box with the name (14px medium) and host (12.5px `fg-3`), outlined chips for the kind (Runs API, A2A, eve, Pairing address) and the network (This machine, Tailnet, HTTPS), then `CapabilityChips`. A reason it cannot connect is an `ErrorNote`; warnings are 12.5px `fg-2` lines.
- **Sign in**: with a code, the grouped code and a primary **Pair**; after it, one line saying the key stays in the server and is never shown. Without one, a `Picker` of global secrets and **Add a key** (name, password field, Save key).
- **Test**: **Run a test turn**, then the reply in quotes (13.5px) with model, timings and tokens under it (12px `fg-3`), or an `ErrorNote` naming the step that failed.
- **Save** (after a passed test): Name and Id side by side (one column on the phone), and the "Make a crew role for it" `Toggle` row, on by default.
- Footer: Cancel, and **Connect**, disabled until the test passed. Connected, the body says what was made and the footer offers Edit the role and Done.

## CapabilityChips

What a thread on a remote harness can do as default chips, then what it cannot as outlined "No …" chips. Never more than a line or two; it wraps.

## RemoteMark

An outlined chip, "Remote · <host>", beside a custom harness's name in the Harnesses list, so a remote agent never passes for a local one. The host always shows with the name an agent gives itself.

## Harness rows

A custom harness row in the Harnesses card adds the `RemoteMark`, "Custom harness · key in <secret>", and under it small buttons: Test connection, Edit (a `Modal` with name, address, key secret, bills, turns at once and Steer) and Remove (`InlineConfirm`, danger). A test shows the same outcome block as the sheet.

Implementation: `apps/web/src/components/ConnectAgent.tsx`, `apps/web/src/pages/SettingsAgents.tsx`, `apps/web/src/components/onboarding-parts.tsx`; links and codes in `packages/shared/connect-agent.ts`.
