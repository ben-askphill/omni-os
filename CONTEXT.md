# Omni OS

Ben's local workspace for agent work: channels, threads, crew and automations, running on his own subscriptions through the official agent CLIs.

## Language

### Work

**Channel**:
A client, project or area that groups threads and carries their shared facts (repo, store, Portal slug, browser profile).
_Avoid_: Project, workspace

**Thread**:
One task's conversation with one agent, from the first prompt through every follow-up, stored and searchable in Omni.
_Avoid_: Chat, session, conversation

**Turn**:
One run of the agent, from a message to its final reply.

**Crew role**:
A charter in `crew/*.md` that gives a thread its job, defaults and extra tools.
_Avoid_: Agent, persona, bot

**Conductor**:
The crew role Ben talks to, which delegates work to crew threads in other channels.

**Automation**:
A cron schedule that starts a new thread on every run.

### Harnesses

**Harness**:
The agent CLI a thread runs in, together with the subscription it bills: Claude Code (Claude plan), Codex (ChatGPT plan) or Cursor Agent (Cursor plan).
_Avoid_: Provider, engine, backend, runtime

**Model**:
The LLM a harness runs for a thread, picked from that harness's own model list.
_Avoid_: Provider

**Effort**:
How hard the **Model** reasons on each step, picked from the levels that model supports in its harness.
_Avoid_: Thinking, reasoning level

**Session**:
The harness's own record of a thread's conversation, which Omni resumes on every follow-up.
_Avoid_: Codex "thread", Cursor "chat" (their names for the same thing)

## Relationships

- A **Channel** has many **Threads**
- A **Thread** runs on one **Harness** and one **Model**, and has one **Session** in that harness
- A **Harness** offers many **Models**; the same model family can appear in several harnesses (Claude Opus runs in Claude Code and in Cursor Agent)
- Ben picks the **Harness** per thread; Omni never switches it on its own
- A thread's **Harness**, **Model** and **Effort** are fixed once it starts; carrying work to another harness means starting a new thread
- A **Crew role** or **Automation** can set a default **Harness**, **Model** and **Effort**; a choice made on the thread wins, and Claude Code is the fallback
- The **Conductor** delegates on the crew role's default **Harness** unless Ben names another one

## Example dialogue

> **Dev:** "This thread runs Claude Opus 5.5 in Cursor Agent, so it uses the Claude plan?"
> **Ben:** "No, the **Harness** decides the bill. Cursor Agent with Opus bills Cursor. Only Claude Code bills the Claude plan."

## Flagged ambiguities

- "provider" was used for both the CLI a thread runs in and the company behind the model. Resolved: the CLI plus its subscription is the **Harness**; the model vendor is only part of the **Model** name.
- Codex calls its conversations "threads" and Cursor calls them "chats". Resolved: in Omni those are **Sessions**; **Thread** always means an Omni thread.
