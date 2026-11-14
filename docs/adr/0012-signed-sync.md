# Machines sign what they push, and only signed changes make a machine act

ADR 0004 and ADR 0008 treat the relay as trusted: every machine applies whatever change the relay hands it. ADR 0009 adds that the relay can mint a Connect session. The adversarial review of 2026-11-14 (issue #667, findings S9, S20, S3 and S13) showed what that trust covers in practice. Anyone who can write to the relay's change log, with a stolen relay token, a relay bug or a compromised Cloudflare account, can:

- make any synced machine run a prompt as Ben, through a `remote_command`, an `assignment` or an `update.ask.*` record;
- start a thread in any directory, such as `~/.ssh`, through a synced thread row or channel whose `cwd`, `repo_path` or `base_dir` points there;
- swap a machine's `sealKey` in its synced device record and read the next secret sent to that machine, or plant a secret drop that every future thread's environment then gets;
- move scheduled automations with `automations.owner`.

Nothing on the receiving machine checks which machine wrote a change. The body of a push also names its own `machine_id`, so one machine's token can write records as another.

## Decision

Each machine signs the changes it pushes. Each machine keeps the other machines' public keys and refuses to act on a change it cannot verify.

- **A signing key per machine.** Each machine makes an Ed25519 key pair on first sync. The private half lives in its secret store, next to the seal key (`OMNI_SEAL_KEY`), and is never handed to a thread. The public half goes in its synced device record as `signKey`, next to `sealKey`.
- **Every pushed change carries `signer` and `sig`.** `signer` is the machine id. `sig` is an Ed25519 signature over the entity, the entity id, a hash of the payload and the change's timestamp. The relay stores both as opaque fields. Its schema does not change, because it already accepts any entity shape (ADR 0008).
- **The relay binds `machine_id` to the token that pushed.** A push's body can no longer choose which machine it claims to be. This is the only relay change.
- **A keyring pins each peer's keys, and a new machine waits for Trust.** The first time a machine sees another machine's device record, it pins that record's `signKey` and `sealKey`. A new machine id syncs ordinary data at once, but its action entities are refused, and listed under Refused changes, until Ben presses Trust on it in Settings > Sync, Signing keys. A secret send to an untrusted machine is refused. A later record with a different key does not replace the pinned one: Signing keys marks the machine "Key changed" with the pinned and new fingerprints, and Ben confirms the new key there (Confirm new key, a re-pair) after a reinstall. Trust and Confirm new key are the same call, `POST /api/sync/devices/:id/confirm-key`, and `GET /api/sync/devices` says whether each machine is trusted. Until Ben confirms, that machine's action entities are refused.
- **`verifyChange(change, keyring)` is a pure function.** It answers valid, or refused with a reason: unsigned, unknown signer, wrong key, bad signature, or a replayed signature. Its table tests are the contract.
- **Action entities need a valid signature.** `remote_command`, `assignment`, `update.ask.*`, `automations.owner` and secret drops (`secretdrop.*`) apply only when `verifyChange` says valid, under the default `actions` mode below. A refused change is logged with the machine and the reason and shown in Settings > Sync. It never applies.
- **Every other entity is signed and logged, not yet enforced.** During rollout, a thread row, an event or an artifact without a valid signature still applies, and the refusal is logged, so a machine on an older build keeps syncing ordinary data until it updates.
- **A setting picks how strict each machine is.** `integrations.syncSignatures` (or `OMNI_SYNC_SIGNATURES`) takes three modes. `actions` enforces signatures on action entities and logs the rest, as above. `strict` refuses every change without a valid signature, for once every machine runs a signing build. `log` applies an unsigned change and only logs it, action entities included, so an older machine can still send commands; a signature that is present but wrong is still refused, and so is a path outside the allowed set. The default stays `actions` (Ben, 2026-11-14): unsigned action entities are refused at once rather than after a grace period, so every machine has to update together.
- **Synced paths are checked against an allowed set.** A synced thread's `cwd`, or a channel's `repo_path` or `base_dir`, must be under the home folder or a known channel checkout, and never under `.ssh`, `.gnupg` or Omni's data folder. The check is a pure policy, and `runner/spawn.ts` applies it again to a thread with no branch before it starts the process. This holds even for a validly signed change, because a signature proves which machine wrote a path, not that the path is safe.
- **Secret drops seal only to a pinned key.** The sender seals to the target's pinned `sealKey`, not to whatever the latest device record says. The target stores a drop only when the sender's signature checks out.

## The trust split

ADR 0009 says the relay holds the authority to mint Connect sessions. That does not change. After this ADR the relay is trusted for two different things:

- **Connect: trusted.** A stolen relay signing key, together with a page the owner opens, can still get a device session. Removing the relay from Connect's trust base is a separate design.
- **Sync: trusted to carry changes, not to write them.** A relay compromise can still read and drop synced data, replay it, or hold it back. It can no longer forge a change from a machine another machine has already trusted: it cannot make that machine's commands run, start a thread outside the allowed paths, read a secret sealed to a trusted key, or plant one under a trusted machine's name. It can still present a machine nobody has seen before, with a key of its own, and that machine's ordinary data (threads, events, artifacts) syncs. Its commands do not run and it gets no secrets unless Ben presses Trust on it.

## Considered

- **Sign only the action entities.** This covers the S2 findings with fewer signatures. It leaves thread rows, the most common change, open to silent edits, and a strict mode would need a second protocol change later. Signing everything now and enforcing in two steps costs one signature per change.
- **Have the relay sign changes.** That moves the trust nowhere: the relay is the party a compromise controls.
- **Trust on first sight for actions too.** Pinning a new machine's key and letting its action entities apply at once needs no manual step, but device records reach a machine through the relay, so a compromised relay could invent a machine id, pin its own key and sign a `remote_command` as it. Ben chose the one-time Trust step instead (2026-11-14): he adds machines rarely and knows when he does.
- **Hold back a new machine's ordinary data until Trust.** Safer, but a new machine would show nothing until Ben finds Signing keys. Ordinary data cannot make a machine act, and synced paths are checked either way.
- **Default to `log` during rollout.** An older machine could keep sending commands while Ben updates one machine at a time, but any relay writer could then make a machine act with an unsigned change. Ben chose `actions`: update every machine together.
- **mTLS or per-machine relay tokens with scopes.** These authenticate the push, which the `machine_id` binding already does. They do not let a receiving machine check who wrote a change it pulls later.

## Consequences

- Device records gain `signKey`. Change payloads gain `signer` and `sig`. A machine on an older build ignores both.
- Every machine updates together. Under `actions` or `strict`, a machine on an older build can still send ordinary changes but can no longer make a signing machine act: its remote commands, assignments, update requests and secret drops are refused at once with "unsigned" in Settings > Sync. Run on another machine, Hand off and `set_secret` from that machine fail until it updates.
- Adding a machine takes one manual step: Ben presses Trust on it in Settings > Sync before it can run commands or receive secrets. A machine set to `log` gives up that protection: anyone who can write to the relay can make it act with an unsigned change, though not with a forged signature or a disallowed path.
- A reinstall or a sync reset makes a new key. The other machines mark it "Key changed", or list it as a new machine if its id changed, until Ben confirms it.
- Replay protection rests on the change's timestamp and the keyring's record of signatures it has seen. A relay can still hold a valid change back and deliver it later within the window the receiving entity allows (a remote command's own deadline, for example).
