# A machine paired through Omni Connect is trusted with its first key

ADR 0012 pinned each machine's signing key on first sight but held its action entities (`remote_command`, `assignment`, `update.ask.*`, `automations.owner`, secret drops) until Ben pressed Trust on it in Settings > Sync. Release 0.1.17 shipped that. On 2026-11-14 every machine updated, nobody had pressed Trust, and every message and new thread sent to another machine sat in `remote_commands` as `sent`. `sync_refused` filled with "waiting for Trust" and nothing in the thread said why. To Ben it looked like a hang.

Handing threads and messages between paired machines without friction is what Omni Connect is for. PRD #667 itself says the other machines "pin that key at pairing" and change it "only by a confirmed re-pair". The per-machine Trust click came later and adds a step to every pairing without stopping the attack it was meant for (see below).

## Decision

- **Trust on first pin.** When the keyring pins a signing key for a machine that had none (the first signed change from it that verifies with the key it carries, or its first signed device record), it also records that machine in `sync_trusted` with that key. Its actions apply at once.
- **A changed key still needs Ben.** A key that differs from the pinned one is kept as seen, never pinned or trusted by itself. Trust stays bound to the key it was given for. The machine shows Key changed in Settings > Sync, and Confirm new key (`POST /api/sync/devices/:id/confirm-key`) pins the new key and trusts it.
- **Actions signed with the announced new key wait instead of being refused.** A change that verifies with the key the machine's own record announced (the seen key) is held in `sync_deferred`, listed under Refused changes as "waiting for the new key to be confirmed", and is discarded when Ben confirms. Future actions signed with the confirmed key apply normally. A signature from any other key is still refused outright. Nothing applies before the confirm.
- **Held actions are counted where Ben confirms.** `GET /api/sync/devices` gains `held`, and the Signing keys row shows "N actions waiting" on desktop web, phone web, the desktop app and iOS.
- **Existing installs are trusted on update.** The migration trusts every machine with a pinned `sign_key` and no `seen_sign_key`, with that key, and drops their "waiting for Trust" log rows. The next sync applies what was held. A machine with a changed key waiting is left for Ben, and a machine already trusted with another key keeps that row. The migration is the same rule as trust on first pin, so running it on every start is harmless.
- **Unchanged:** signature verification, `roleProblem`, the `syncSignatures` modes, synced path checks and sealing secrets only to a pinned key.

## The trust split

- **Pairing is the trust step.** The relay accepts pushes only from a machine signed in through Clerk with a user on `ALLOWED_USERS` (ADR 0008), and binds each `machine_id` to the token that first pushed as it (ADR 0012). A machine that can sign changes onto Ben's relay has already paired through Omni Connect.
- **The relay is trusted for Connect pairing.** As ADR 0009 says, the relay can mint Connect sessions. It is trusted the same way to vouch for a machine id the first time one appears.
- **Signatures narrow what a relay compromise can do after pinning.** Once a machine's key is pinned, a relay compromise cannot forge its commands, assignments, update asks, owner claims or secret drops, cannot swap its key without Ben confirming, and cannot read secrets sealed to it. It can still drop, delay or replay changes within their deadlines.
- **What this gives up.** ADR 0012 turned down trust on first sight because a compromised relay could invent a machine id, pin its own key and send commands as that new machine. That is now possible again for a machine id nobody has seen. Settings > Sync, Signing keys lists every machine with its fingerprint, so an unknown entry is visible. Ben accepts this (2026-11-14): the Trust click only helps if he checks fingerprints on every pairing, and the incident showed the step silently blocks normal use.

## Considered

- **Keep the Trust click and explain the hang.** That keeps every pairing a two-step job, and the step protects only when Ben compares fingerprints each time.
- **Auto-trust only machines seen before 0.1.17.** That fixes the incident but leaves the same trap for the next machine he pairs.
- **Trust a changed key automatically too.** Then a relay compromise could replace any known machine's key, and that is the case signatures exist to stop.

## Consequences

- Pairing a machine through Omni Connect is enough for threads, messages, Hand off, update asks and `set_secret` to work between it and the others.
- A reinstall that keeps its sync id still needs Confirm new key on each other machine. Confirmation discards its held actions. Send them again after confirmation if they are still needed.
- Notifying the sending machine, or the target's Inbox, that actions wait for a key confirmation is a follow-up (#698). For now the count shows in Settings > Sync.

## Additions after the security review of #704

- **Confirmation discards held actions.** Confirm new key pins and trusts the announced key in the same local transaction that removes all of that machine's deferred action changes. This includes commands, assignments, update asks, owner claims and secret drops or acknowledgements, even when they were held on a missing dependency or handler. Each discard appears in Refused changes with a request to send it again if needed. Deferred ordinary data and other machines' actions stay in place. The API response and the existing confirmation controls stay the same on desktop web, phone web, desktop app and iOS. Discarding is the smallest safe option because replay would need an action preview and approval bound to the exact reviewed batch, not only the existing count.
- **First-key auto-trust checks relay registration.** Before pinning a first signing key from a valid signed change, the receiver fetches the authenticated `GET /v1/connect/machines` list from its configured relay and requires that machine id in it. A missing registration leaves the signed changes deferred with a reason. An unavailable, unsupported or malformed list prevents auto-trust and the next sync retries. Synced device records cannot substitute for this check. First-key trust still happens without a Trust click after this check, including when an action precedes the device record. The retroactive trust migration is unchanged.
- **Token-binding limit.** The relay enforces `tokens.machine_id` in `RelayStore.bindMachine` on push. It also stores the Connect registration's `connect_machines.token_id`, but its machine-list response exposes neither binding. Pulled changes contain no authenticated token id or binding proof either. The receiver can therefore check only Connect registration, not that the token which pushed a particular change owns that registration. A registered machine id pushed under a different, previously unbound token is still a gap. Closing it requires a relay contract that ties accepted changes to the registration's token, including handling re-sign-in and old log entries. This change does not claim that contract exists, and a compromised relay can still invent registrations as well as machine ids.
