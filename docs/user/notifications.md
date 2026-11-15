# Notifications

Omni can tell you when something needs you: in the desktop app as native notifications, in a browser or phone browser as browser notifications, and on the iPhone app as push alerts ([Remote access](remote-access.md)). The settings live in **Settings > Notifications**.

## What notifies

| Kind | When |
|---|---|
| Questions | An agent asked you something (`ask_user_question`) and waits for the answer. A newer question card in the same thread notifies again. |
| Failed threads | A turn failed, or Omni could not prepare a thread's worktree. |
| Finished threads | A turn finished and its result waits in Needs you. A delegated thread's success goes to its parent as a crew report instead. |
| Crew reports | A delegated thread reported back to a Conductor thread. |
| Pull requests | A PR under Watch PR has new failing checks or new review feedback. |

Every kind is on by default. Turn one off under **What notifies**. Under **Channels**, turn a channel off to keep it silent: its results and questions still show in Needs you.

Some things never notify:

- the thread you have open in the window or tab in front;
- a thread you stopped yourself;
- results and questions from before the app or page started, and anything older than ten minutes when it first arrives (a sync that brings in a day of results stays quiet).

A notification goes away once you read the result or answer the question, here or on your other Mac. Clicking one opens its thread.

## Desktop app

The desktop app posts native notifications from its main process, so they arrive even with every Omni window closed (on a Mac the app stays in the Dock). They are on by default. Turn them off with **Notify from the desktop app**.

- On a Mac, macOS asks once whether Omni may send notifications. If none arrive, allow Omni in System Settings > Notifications. Focus modes can hold them back too.
- The app shows one notification per thread: a newer one for the same thread replaces the older one.
- These choices belong to the app on this machine. They do not sync, and the browser's choices do not apply to it.

## Browser and phone browser

Browser notifications start off. Turn on **Notify in this browser**; the browser asks for permission the first time. They only arrive while an Omni tab is open. The choices stay in that browser.

## Where the events come from

Finished, failed and question notifications come from Needs you, so they include threads that ran on your other Mac and synced here. Crew reports and pull requests come from the server's live feed, so only the machine where the report landed or the PR watch runs notifies for them.
