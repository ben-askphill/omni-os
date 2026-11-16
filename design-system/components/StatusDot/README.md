StatusDot is the one status mark: every state a thread can be in has its own drawing, on desktop web, phone web and the desktop app (`StatusDot` in `apps/web/src/components/ui/status.tsx`, `Mark` in `packages/shared/status.ts`, PR #755).

```jsx
<StatusDot mark="working" />            // Running: filled blue disc with a halo
<StatusDot mark="crew_question" />      // Crew waits on you: vermilion diamond with a satellite
<StatusDot state="needs" size={8} />    // a plain status word still works
<Status mark="review" />                // the pill, Ready for review
```

## The rule

- **Shape says who has the ball.** Circle: the agent. Square: a system outside Omni (checks, a usage limit). Diamond: you. Cross or triangle: broken.
- **Colour repeats it.** Blue (`live`), amber (`warn`), vermilion (`needs`), red (`danger-text`), with volt (`done`) for done and grey (`fg-4`) for quiet states. No state depends on colour alone.
- **Fill says how far along.** Hollow, half, filled.
- **A satellite dot** (top right) means the state belongs to a thread under this one.
- **Two motions.** A halo leaves the mark while the agent's own turn works (`--dur-ping`). The mark breathes slowly while it waits on other work (1.5 × `--dur-ping`). Everything that waits on you, is broken or has settled holds still. Nothing spins, and reduced motion stops both: the shapes still tell every state apart.

## The 18 states

| Mark | State | Meaning | Motion |
| --- | --- | --- | --- |
| Grey dashed ring | Queued | It waits for a free slot | Still |
| Half-filled blue circle | Starting | Its folder is being prepared, or the agent has not picked the message up yet | Halo |
| Filled blue disc | Running | Its own turn runs | Halo |
| Blue dot inside a thin ring | Running a tool | A tool call in its turn has not returned yet (open thread only) | Halo |
| Blue disc with a satellite | Waiting on crew | Its own turn ended; threads or sub-agents it delegated still work | Breathes |
| Filled amber square | Checks running | Checks on its pull request have not finished | Breathes |
| Half-filled amber square | Resumes at reset | It hit the usage limit and continues by itself when the limit resets | Breathes |
| Hollow amber square | Usage limit | Its harness stopped the turn at the plan's usage limit | Still |
| Filled vermilion diamond | Waiting on you | Its agent asked you a question and waits | Still |
| Vermilion diamond with a satellite | Crew waits on you | A thread under this one asked you a question and waits | Still |
| Half-filled vermilion diamond | Ready for review | It finished and its pull request is open (where the PR is loaded; sidebar rows show Done) | Still |
| Hollow vermilion diamond | Message held | A restart kept a message back: it is sent when you say so | Still |
| Red cross | Failed | Its turn ended in an error | Still |
| Red cross with a satellite | Crew failed | A thread under this one failed and you have not opened it | Still |
| Hollow red triangle | Setup failed | Its folder could not be prepared, so it never started | Still |
| Volt disc with a tick | Done | Its turn finished | Still |
| Grey bar | Stopped | Its turn was stopped | Still |
| Small grey dot | Idle | It has not run, or it was imported | Still |

A thread Ben marked done shows a plain grey check instead (ThreadRow `markedDone`).

## Colour-blind note

Amber, vermilion and red collapse into one olive-brown under deuteranopia and protanopia (light mode ΔE 3 to 19 and 6 to 14, Machado matrices). They never share a shape: amber is always a square, vermilion a diamond, red a cross or triangle. Blue, volt and grey stay apart. No two marks share a drawing.

## Not built: needs data

Shown in the legend only, marked "needs data":

- **Asked permission**: threads run headless, so no permission prompt reaches Omni.
- **Finishing**: nothing arrives before the result.
- **Stalled**: there is no heartbeat, and a long tool call looks the same.
- **Running a tool in list rows**: lists carry no transcript rows, so this needs an activity field from the server.

## Usage

- Rows draw it at 7 to 8px; a shaped mark never draws below 8px, one with a satellite never below 9.
- The mark's name and meaning are its tooltip and accessible label (`role="img"`). A failed pill is `role="alert"`.
- `StatusGlyph` is the older name for the same component and takes the plain words (`running`, `needs`, `limited`, `failed`, `done`, `settled`, `queued`, `idle`).
- `Loader` is the running dot at half its box in the text colour, for waits that are not a thread at work. The Omni mark never shows that something runs.
- The native iOS app keeps its own glyphs (`components/mobile/native/StatusGlyph.tsx`).
