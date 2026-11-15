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

When one thread has several things at once, it notifies once, with what matters most: a question, then a failure, then a finish. A question older than one already shown for its thread never notifies, so answering the newer of two questions does not bring the older one back as news.

A notification goes away once you read the result or answer the question, here or on your other Mac. Clicking one opens its thread.

## iPhone app

The iPhone app has the same kinds, Pull requests included, as switches under its own **Settings > Notifications**, per server. It shows one alert per thread: a newer one for the same thread replaces it. An alert goes away once you open its thread on the phone, or once you read its result or answer its question on any device and the app next comes to the front. For a delegated thread, opening it on the Mac counts as reading it. An older build of the app gets no Pull requests alerts and no one-per-thread grouping until it is updated. With the app closed, alerts read elsewhere stay until you open it.

## Desktop app

The desktop app posts native notifications from its main process, so they arrive even with every Omni window closed (on a Mac the app stays in the Dock). They are on by default. Turn them off with **Notify from the desktop app**.

- On a Mac, macOS asks once whether Omni may send notifications. If none arrive, allow Omni in System Settings > Notifications. Focus modes can hold them back too.
- The app shows one notification per thread: a newer one for the same thread replaces the older one.
- These choices belong to the app on this machine. They do not sync, and the browser's choices do not apply to it.
- Before this, the app's page posted browser notifications with the page's own channel switches. The first time the updated app opens, channels you had turned off there are turned off in the app's setting too, once.
- Clicking an old notification in Notification Center after the app restarted only brings Omni forward; the app no longer knows which thread it was for.

## Browser and phone browser

Browser notifications start off. Turn on **Notify in this browser**; the browser asks for permission the first time. They only arrive while an Omni tab is open. The choices stay in that browser.

## Where the events come from

Finished, failed and question notifications come from Needs you, so they include threads that ran on your other Mac and synced here, and the app catches up on them after a reconnect.

Crew reports and pull requests come from the server's live feed:

- only the machine where the report landed or the PR watch runs notifies for them;
- one sent while the app or tab was not connected to the server (the app starting, the server restarting) is not shown later;
- a crew report usually wakes its Conductor thread, so a Finished notification for that thread follows the report, as on the iPhone.
