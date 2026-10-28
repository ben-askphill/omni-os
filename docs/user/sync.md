# Sync between two Macs

Optional. Each Mac keeps its own SQLite as the source of truth; a Supabase project you own relays the changes between them (channels, sidebar folders, threads, events, artifacts, automation runs and event deliveries, settings) and holds thread files in a private bucket. With no credentials sync is off and Omni behaves as before. Why a relay and not a shared database: [ADR 0004](../adr/0004-supabase-sync.md).

## One-time Supabase setup

1. Create a Supabase project (the free tier is enough).
2. SQL Editor: paste `supabase/migrations/0001_changes.sql` and run it. It is safe to run again. Check that it worked:
   - Table Editor shows `changes`, with RLS on.
   - Storage shows a private bucket `omni`.
   - Database, Publications, `supabase_realtime` includes `changes`.
3. Authentication, Users, Add user: create the one user both Macs sign in as (tick Auto Confirm). Then, under Sign In / Providers, turn off "Allow new users to sign up".
4. Only if you want to sign in with an emailed code rather than a password: Authentication, Emails, Magic Link template, add `{{ .Token }}` to the body so the email carries the 6-digit code.
5. Project Settings, API: copy the Project URL and the anon (or publishable) key. Never use the service-role or secret key; Omni refuses one.

## On each Mac

Open the Web UI Sync page (`#/sync`) or Mac app Settings, Sync. Paste the URL and key, sign in as that same user. The first sign-in queues this Mac's existing history, and the other Mac pulls it. The URL, the key and the sign-in token go to the Keychain (global scope, never passed to threads); the password is used once and not stored. Sign Out stops syncing and removes them; Pause keeps them.

- Path map: paths travel with the home folder as `~`. When the other Mac keeps a folder somewhere else, map it on the Sync page, like `~/work` to `~/code`.
- Files: after a Mac's first sync, Omni uploads the files and session files of every thread it wrote last, in the background (the log counts progress every 50 threads). After that, a thread's files go up after each turn. The bucket fills a few minutes after the rows.
- `npm run sync:backfill`: queue every existing row again, for instance after restoring a database. It is idempotent and skips rows the other Mac wrote last.
- Signing in to a different project or user starts that relay from the beginning and queues the history again.
- Sidebar folders sync, along with which folder each thread sits in. Whether a folder shows open or closed stays per Mac. A relay set up before folders synced refuses them: paste `0001_changes.sql` in the SQL Editor again. Until then the rest keeps syncing and folders wait, counted as held.
- Needs you is the same on both Macs: a result reviewed on one leaves the other's after the next sync, and a newer result stays unread. A relay set up before this refuses results and reads: paste `0001_changes.sql` again, as for folders. A thread marked done is done on both Macs, and a run on either brings it back.
- Auto's routing reason and a model or harness switch queued for the next turn sync with the thread. A switch still waits for the running turn and its background tasks to end.
- Published-page and GitHub webhook deliveries sync as `trigger_delivery`. A relay set up before these events existed needs `0001_changes.sql` run again, or deliveries wait as held while the rest keeps syncing. Only the Mac that owns automations starts their runs. Signing secrets stay in each Mac's Keychain. See [Automations](automations.md#event-automations).
- Channel actions and worktree retention stay per Mac; sync does not copy them. See [Configuration](configuration.md#channel-actions) and [Known limits](limits.md).
- A thread runs on one Mac at a time. Its row names the Mac running it (`run_machine`), so the other Mac shows it read-only until the run ends there, and an edit from the other Mac mid-run (a rename) never changes its status. After a crash, only the Mac that ran it marks it failed.
- Scheduled automations run on one Mac: the Sync page says which, and "Run them here" moves them. The first Mac to finish a sync with no owner set takes them. Manual runs work on either Mac.
- Copying `data/` to another Mac is fine: the folder remembers the Mac it was set up on (its hardware UUID), and on the next start the copy takes a new sync id and pulls the history again, logging one `[sync] this data folder was copied from another Mac` line. It never overwrites the Mac it came from, and scheduled automations stay there until you press "Run them here".


## Hand off a thread

Move a thread to your other Mac. If a turn is running, the other Mac carries on where it was; if the thread is idle, it waits there for your next message. For a running turn Omni stops it here, uploads the session and the thread's files, and the other Mac resumes the same session with a note that the last turn was cut off, then sends the messages that were queued for it. This Mac shows the thread read-only while it runs there. An idle thread skips the note and the continue: the files and session move, and it shows "Handed off" until a turn runs. The Conductor can list targets with `list_devices` and hand it off with `hand_off_thread`. On desktop web, use the header's Hand off button or the thread's right-click menu; a narrow header puts it in More. On a phone use Thread options. The Mac app also has it in the Thread menu.

- Both Macs need sync on and Omni running. Tailscale is optional: Omni reads `tailscale status` to show whether the other Mac is up, and refuses one Tailscale sees as offline. The handoff itself goes through the relay, so without Tailscale the Mac shows as unknown and picks the thread up when it next syncs. Until then you can cancel, and the thread stays stopped here.
- A delegated thread that reports to another thread cannot be handed off, nor can an archived thread, a thread waiting on a usage limit, or a thread while its delegated threads still run. Only the Mac that holds a thread hands it off; from the other Mac, use Take over.
- What travels: the session, the thread's files, and queued messages (their text, not their attachments).
- A worktree thread also takes its branch's commits that are on no remote, and its uncommitted and untracked files, which arrive uncommitted. Files `.gitignore` covers stay on each Mac. The other Mac's own worktree for the thread must not have changes of its own, and the whole bundle must fit in 50 MB.
- A thread in a shared folder (a repo without a worktree per thread, or your workspace) runs in that folder on the other Mac. Uncommitted changes in it stay on this Mac; the other Mac's agent is told so.
- Claude Code, Hermes and Cursor Cloud threads can always go. Codex and Cursor threads can go once they have reported their session, after their first reply. A Cursor Cloud thread's run is cancelled here and the other Mac follows up on the same cloud agent, so it needs `CURSOR_API_KEY` too.
- If the other Mac cannot pick it up, or you cancel, the thread stays stopped here with its queued messages waiting for Resume, and the banner says why.

## Take over a thread

The reverse of Hand off: bring a thread your other Mac holds to the Mac you are using. The Mac running a thread holds it; between turns, the Mac that ran it last (or took it since) does. Open the thread and the note over the reply box says where it is, "This thread is running on Ben's MacBook Air." or "Last ran on Ben's MacBook Air.", with a Take over button. Confirm, and the other Mac does what Hand off does: it stops a running turn, uploads the session and the thread's files, and packs the worktree. Then this Mac picks the thread up. A cut turn continues here with the same note as a handoff, followed by the messages queued over there; an idle thread waits here for your next message. Take over is also in the thread's right-click menu on desktop web and in the Mac app (and its Thread menu), and in Thread options on a phone. The Conductor does it with `hand_off_thread` and `to: "here"`.

- The other Mac answers when it next syncs. If it is asleep, the request waits and goes through when it wakes; until then you can cancel it, and this Mac starts no turn in the thread. A request no Mac has answered after an hour expires, so a Mac that wakes the next morning does not give the thread away.
- The limits of Hand off apply: a delegated thread, an archived thread, a thread waiting on a usage limit, a thread whose delegated threads still run, and a Codex or Cursor thread before its first reply stay where they are, and the note says why instead of offering the button. The other Mac checks again when it answers; if it cannot give the thread up, it says why and leaves the thread as it was.
- If the thread moves elsewhere before the other Mac answers, this Mac drops the request. A thread that has not run since this update has no recorded Mac between turns, so it offers Take over only once it runs again.
- You can still just reply to an idle thread here, as before Take over existed: the turn runs on this Mac with the session as it last synced, and this Mac holds the thread from then on. A worktree thread then lacks the other Mac's unpushed commits and uncommitted changes, which only Take over brings along.
