---
name: Decision record from a meeting
description: Turn a meeting's decisions into a new or updated ADR
argument-hint: <meeting notes, link or name>
kind: task
pack: core
---
Record the decisions from this meeting as architecture decision records: $ARGUMENTS

1. Read the meeting notes or transcript. List each decision that changes how the system is built, with who made it.
2. Find the existing ADRs (usually `docs/adr/`) and the project's ADR format. Match it.
3. For each decision, update the ADR it changes (mark what it supersedes) or write a new one with the next number.
4. Keep each ADR to context, decision and consequences. Quote the meeting where it matters.
5. Show the diff and the list of decisions you left out because they were not architectural. Do not merge or push unless asked.
