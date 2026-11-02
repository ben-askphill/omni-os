# Sync between two Macs

Optional. Each Mac keeps its own SQLite as the source of truth. A relay you deploy to your own Cloudflare account carries the changes between them (channels, sidebar folders, threads, events, artifacts, automation runs and event deliveries, settings) and keeps thread files in R2. With no relay signed in, sync is off and Omni behaves as before. Why a relay and not a shared database: [ADR 0004](../adr/0004-supabase-sync.md). Why Cloudflare and Clerk: [ADR 0008](../adr/0008-cloudflare-relay.md).

## One-time relay setup

You need a Cloudflare account (the free plan is enough) and Google sign-in set up in Omni, with your Google account linked in Settings > Sharing & access ([remote access](remote-access.md)).

1. Run `npm run relay:config` on that Omni. It prints the steps with your Clerk app and user id filled in: `wrangler login`, create the `omni-relay` R2 bucket, `wrangler deploy` from `apps/relay`, then set the Worker's three secrets (`CLERK_ISSUER`, `CLERK_CLIENT_ID`, `ALLOWED_USERS`). It also prints the four optional Cloudflare secrets [Omni Connect](omni-connect.md) needs.
2. `wrangler deploy` prints the relay's URL, like `https://omni-relay.<account>.workers.dev`. Opening `<url>/v1/info` shows the Clerk app it trusts.

Later updates are `npx wrangler deploy` from `apps/relay` again. The secrets stay. To let another Clerk user in, or take one out, run `npx wrangler secret put ALLOWED_USERS` with the ids separated by commas. Taking a user out signs out all of that user's machines at once.

## On each Mac

Open Settings > Sync (web `#/settings/sync`, where the old `#/sync` also lands; the Mac app's Sync section; on the phone, Settings, Sync). Paste the relay URL and press Sign in with Google. Omni shows a code and opens Clerk's page. Check the page shows the same code, then approve as the Google account on `ALLOWED_USERS`. The first sign-in queues this Mac's existing history, and the other Mac pulls it.

Omni keeps the relay URL and this machine's relay token in the secret store: the Keychain on a Mac, `data/secrets.json` on Linux. They are global and never passed to threads. The Google sign-in itself is not kept. Sign Out ends this machine's token on the relay and removes both, and the relay deletes the machine's [Omni Connect](omni-connect.md) tunnel. Pause keeps them. Omni Connect uses this same relay sign-in.

Every machine has to use the Clerk app the relay trusts. If they differ, setup says so before it asks Clerk. A Google account that is not on `ALLOWED_USERS` is refused with its Clerk user id, so you can add it.

### Moving from Supabase

Before this, the relay was a Supabase project. A machine that still holds the Supabase credentials says "Sync moved to Cloudflare" in Settings > Sync. Sign in to the new relay once on each machine. The sign-in removes the Supabase credentials, and the machine's history is queued again for the new relay, so nothing is lost. Once every machine has moved, you can delete the Supabase project.

- Path map: paths travel with the home folder as `~`. When the other Mac keeps a folder somewhere else, map it under Advanced in Settings > Sync, like `~/work` to `~/code`.
- Files: after a Mac's first sync, Omni uploads the files and session files of every thread it wrote last, in the background (the log counts progress every 50 threads). After that, a thread's files go up after each turn. The bucket fills a few minutes after the rows.
- Before a thread resumes, Omni downloads its latest session file. When that download fails or takes over 15 seconds, the thread does not resume the copy on this Mac, which may miss turns the other Mac ran. A "Session not up to date" card says why, and your message waits. Try again downloads it again; Start with fresh context starts a new session that reads the thread so far. Both are on desktop, phone and the Mac app.
- `npm run sync:backfill`: queue every existing row again, for instance after restoring a database. It is idempotent and skips rows the other Mac wrote last.
- Signing in to a different relay or user starts that relay from the beginning and queues the history again.
- Sidebar folders sync, along with which folder each thread sits in. Whether a folder shows open or closed stays per Mac.
- Needs you is the same on both Macs: a result reviewed on one leaves the other's after the next sync, and a newer result stays unread. A thread marked done is done on both Macs, and a run on either brings it back.
- Auto's routing reason and a model or harness switch queued for the next turn sync with the thread. A switch still waits for the running turn and its background tasks to end.
- Published-page and GitHub webhook deliveries sync as `trigger_delivery`. Only the Mac that owns automations starts their runs. Signing secrets stay in each Mac's secret store. See [Automations](automations.md#event-automations).
- Channel actions and worktree retention stay per Mac; sync does not copy them. See [Configuration](configuration.md#channel-actions) and [Known limits](limits.md).
- A thread runs on one Mac at a time. Its row names the Mac running it (`run_machine`), so the other Mac shows it read-only until the run ends there, and an edit from the other Mac mid-run (a rename) never changes its status. After a crash, only the Mac that ran it marks it failed.
- Scheduled automations run on one Mac: Settings > Sync says which, and "Run them here" moves them. The first Mac to finish a sync with no owner set takes them. Manual runs work on either Mac.
- Copying `data/` to another Mac is fine: the folder remembers the Mac it was set up on (its hardware UUID), and on the next start the copy takes a new sync id and pulls the history again, logging one `[sync] this data folder was copied from another Mac` line. It never overwrites the Mac it came from, and scheduled automations stay there until you press "Run them here".


## Run a thread on another machine

Pick where a new thread runs: this machine, or any other synced machine, such as a Linux box with more CPU and memory. The machine you talk to stays the hub. The thread is made there, goes to the other machine with its first message, runs there, and syncs back as it goes, so you watch it from the hub as usual (a few seconds behind).

- A machine whose sync state was reset comes back under a new id. Every picker lists one entry per Tailscale node, the newest, so the old id no longer shows. Threads still assigned to the old id stay on it until they are handed off.
- The default is Settings > Threads, Run new threads on (`runOn.device` in `data/omni.config.json`, per machine). The new-thread composer's Machine chip ("On Ben's MacBook Pro": this machine by its own name, or "Unnamed machine" when the server reports none; next to the model pill) overrides it per thread, on desktop, phone and the Mac app; it is hidden while this is the only machine. The Conductor's `delegate` takes `device` too (a machine's name or id, or `here`).
- An offline default stays selected in the composer. Sending reports why it cannot run there; choose this machine (listed by its name) explicitly to run locally.
- The other machine cuts a worktree thread's worktree itself, from the channel's repo at the same path (or through its path map), so the repo must be cloned there.
- Your later messages and Stop go to the machine running the thread. Skills and file mentions resolve on that machine, and attached text context goes with replies. Accepted replies do not replay after Take over. Each reply, Stop and limit action is a command the other machine answers; one it does not take within a day (two minutes for a Stop) shows in the transcript as not delivered, with why, so nothing you sent goes missing in silence. A thread the Conductor delegated there reports back to the Conductor on the hub. Threads that a thread on the other machine delegates run there too, and your messages and Stop reach them the same way.
- A switch of harness or model keeps the thread on that machine: the next message runs it there on the new harness. A usage-limit stop there shows on the hub with Resume and Resume at reset, which that machine acts on at its next sync.
- Files you attach go too, on the first message and on replies, up to 50 MB each. The hub keeps a copy for its transcript; the other machine fetches them before it sends the message, and a message whose files have not arrived waits for the next sync.
- Take over brings the thread back to this machine; from then on it runs here.
- If the other machine cannot start it, the thread stops here with why. A worktree thread's Retry runs it on this machine; any other keeps its first message for Resume.
- Team members stay with their lead on the hub.
- The other machine needs its own harness logins. On a Linux box, use `claude setup-token` and save it as the global secret `CLAUDE_CODE_OAUTH_TOKEN`. For Codex, run `codex login --device-auth` there; never copy `~/.codex/auth.json` from a Mac, or the two keep logging each other out.

## Where a thread runs

An open thread has the same Machine chip in its reply box, next to the model pill, on desktop web, the phone and the Mac app. It names the machine that holds the thread by its name: "On Ben's MacBook Pro" for this one, or "On Ben's MacBook Air" with whether it is running there now or last ran there. Open it to move the thread: while this machine holds it, the other machines are listed as Hand off; while another holds it, this machine (by its name) is Take over. The chip is hidden while there is one machine, and while a handoff is under way (the card in the transcript says so). Hand off and Take over are not in the thread's menu. On a phone the chip is in the row over the reply box and opens the same sheet a new thread picks its machine in.

## Hand off a thread

Move a thread to your other Mac. If a turn is running, the other Mac carries on where it was; if the thread is idle, it waits there for your next message. For a running turn Omni stops it here, uploads the session and the thread's files, and the other Mac resumes the same session with a note that the last turn was cut off, then sends the messages that were queued for it. This Mac shows the thread read-only while it runs there. An idle thread skips the note and the continue: the files and session move, and it shows "Handed off" until a turn runs. The Conductor can list targets with `list_devices` and hand it off with `hand_off_thread`. On every surface, open the Machine chip in the reply box and pick the machine. The Mac app also has Hand Off to in the Thread menu of the menu bar.

- Both Macs need sync on and Omni running. Tailscale is optional: Omni reads `tailscale status` to show whether the other Mac is up, and refuses one Tailscale sees as offline. The handoff itself goes through the relay, so without Tailscale the Mac shows as unknown and picks the thread up when it next syncs. Until then you can cancel, and the thread stays stopped here.
- A delegated thread that reports to another thread cannot be handed off, nor can an archived thread, a thread waiting on a usage limit, or a thread while its delegated threads still run. Only the Mac that holds a thread hands it off; from the other Mac, use Take over.
- What travels: the session, the thread's files, and queued messages (their text, not their attachments).
- A worktree thread also takes its branch's commits that are on no remote, and its uncommitted and untracked files, which arrive uncommitted. Files `.gitignore` covers stay on each Mac. The other Mac's own worktree for the thread must not have changes of its own, and the whole bundle must fit in 50 MB.
- A thread in a shared folder (a repo without a worktree per thread, or your workspace) runs in that folder on the other Mac. Uncommitted changes in it stay on this Mac; the other Mac's agent is told so.
- Claude Code, Hermes and Cursor Cloud threads can always go. Codex and Cursor threads can go once they have reported their session, after their first reply. A Cursor Cloud thread's run is cancelled here and the other Mac follows up on the same cloud agent, so it needs `CURSOR_API_KEY` too.
- If the other Mac cannot pick it up, or you cancel, the thread stays stopped here with its queued messages waiting for Resume, and the banner says why.

## Take over a thread

The reverse of Hand off: bring a thread your other Mac holds to the Mac you are using. The Mac running a thread holds it; between turns, the Mac that ran it last (or took it since) does. Open the thread and the Machine chip in the reply box names that Mac, running there now or last ran there. Pick this machine in it, listed by its name, and confirm, and the other Mac does what Hand off does: it stops a running turn, uploads the session and the thread's files, and packs the worktree. Then this Mac picks the thread up. A cut turn continues here with the same note as a handoff, followed by the messages queued over there; an idle thread waits here for your next message. The Mac app also has Take Over in the Thread menu of the menu bar. The Conductor does it with `hand_off_thread` and `to: "here"`.

- The other Mac answers when it next syncs. If it is asleep, the request waits and goes through when it wakes; until then you can cancel it, and this Mac starts no turn in the thread. A request no Mac has answered after an hour expires, so a Mac that wakes the next morning does not give the thread away.
- The limits of Hand off apply: a delegated thread, an archived thread, a thread waiting on a usage limit, a thread whose delegated threads still run, and a Codex or Cursor thread before its first reply stay where they are, and the chip says why under this machine's name instead of offering it. The other Mac checks again when it answers; if it cannot give the thread up, it says why and leaves the thread as it was.
- If the thread moves elsewhere before the other Mac answers, this Mac drops the request. A thread that has not run since this update has no recorded Mac between turns, so it offers Take over only once it runs again.
- You can still just reply to an idle thread here, as before Take over existed: the turn runs on this Mac with the session as it last synced, and this Mac holds the thread from then on. A worktree thread then lacks the other Mac's unpushed commits and uncommitted changes, which only Take over brings along. A delegated thread is the exception: it stays on the Mac that holds it, and your reply goes there.
- Only your reply or Take over moves a thread. Something Omni does on its own, such as a PR watch polled on this Mac or a crew report, never starts a turn here for a thread your other Mac holds: it waits in the thread for Resume, which runs it here. If the other Mac was still running a turn when the thread moved (it was asleep when you replied here), that turn stops when it reconnects, and the thread says so.
