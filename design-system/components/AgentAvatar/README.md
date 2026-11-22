AgentAvatar is an agent's face wherever the Web UI shows one, on desktop web, phone web and the desktop app (`AgentAvatar` in `apps/web/src/components/AgentAvatar.tsx`, the crew character in `CrewCharacter.tsx`). It draws exactly what `agentFace()` in `packages/shared/agent-avatar.ts` returns, as the iOS app does ([ADR 0021](../../../docs/adr/0021-crew-avatars.md)).

```jsx
<AgentAvatar agent={{ id: 'researcher', name: 'Researcher' }} size={24} />
<AgentAvatar agent={role} size={22} shows={{ member: 'working' }} placement="focus" />  // eyes from a member's state
```

## What it draws

- **The chain.** The photo the user uploaded, round; else its icon, emoji or SVG on the agent's color (the 06 Iconography glyphs, as a channel avatar draws them); else its **crew character**. There is no initials disc.
- **The character.** One of 16 shapes bent from the Omni ring: an inline SVG on the shape's grid, the body filled with the agent's color and outlined in `--fg` (#17181a light, #eceae5 dark), two eyes in the eye ink (`--ink` or white, whichever reads on the color), and the Conductor's satellite in `--fg`. The whole drawing, eyes included, leans 10° like the logo. **No disc** behind it: the silhouette is the face.
- **Shape and color.** The crew file's `avatar.shape` and `avatar.bg`; without them the built-in agents take their own pair (circle Conductor in Ink, droplet Researcher in Sky, squircle Builder in Amber, pill-wide Reviewer in Violet, arch Writer in Rose, tray Admin in Mint, triangle Store ops in Green, pill-tall Usage scan in Sun, pebble Hermes in Lilac) and any other agent one of the seven spare pairs, picked from its id.

## Sizes

- 16px is the smallest. In use: 88 (Identity preview), 36 (phone rows), 32, 30 (Settings › Agents), 28 (Agent picker), 24 (author lines), 22 (member avatars, lanes), 20, 18 and 16 (thread header chip, mention pills, the phone thread's sub line, the avatar mark).
- Each size draws its own drawing: the 128 grid from 32px, the 24 grid from 19 to 31px, the 18 grid at 18px and below. Stroke and eyes are set per size (1.4px stroke and 2.44px eyes at 16, up to 15/128 and 13/128 of the size from 64px), and the eyes always clear the outline by at least 0.75px or 35% of the stroke.
- From 32px the eyes are circles, rounded squares, diamonds and arcs; at 31px and below, dots, plain squares, tall bars and chevrons.

## States

- Idle, thinking and working are the same eyes in different places; waiting takes squares, needs you diamonds (bars when small), done arcs (chevrons when small). The card's States row draws all six.
- `shows` is what the eyes read: a thread's status mark (`{ mark }`) or a group member's state (`{ member }`). The thread header, the quick-actions card, the member list, lanes, phone thread rows, the avatar mark and the head of the reply being written pass it. In focus (`placement="focus"`: the open thread's header, the member list, lanes, the live reply head) the eyes tell thinking from working; in a row a running thread works.
- Avatars with no thread behind them (Settings, pickers, mentions) and the heads of past replies stay idle (`placement="still"`).

## Motion

- Each state moves as the Motion board draws it, played from code (the Web Animations API on the web, Reanimated on iOS) from the one set of numbers in `packages/shared/crew-motion.ts`. No CSS keyframes: the eye groups keep only `transform-box: fill-box` and a centred origin.
- Loops, only in focus (thread header, member list, lanes, the live reply head, the Settings preview): idle breathes (`--dur-breathe`, 1.025 × .975) and blinks twice, then glances (`--dur-crew-glance`); thinking sways ±2.5° about 50% 70% (`--dur-tick`) and looks centre, left, centre, blinks, right (`--dur-crew-look`); working bounces (`--dur-crew-bounce`) and scans left and right (`--dur-crew-scan` each); waiting breathes slowly, eyes too (`--dur-crew-wait`, 1.04 × .955). Needs you and done hold still.
- A live change of state, in focus and in rows: the eyes squeeze to 1.15 × .06 (`--dur-crew-squeeze`, stretch), the glyphs swap, and the new eyes spring open (`--dur-crew-open`). Idle to thinking opens into wide eyes (1.22, `--dur-crew-wide`, held `--dur-crew-wide-hold`); into done the body hops once (`--dur-crew-hop`, settle). Never on first render: a list that loads draws still faces.
- A new agent in the Settings preview pops the body from .7 (`--dur-crew-pop`, spring).
- Reduced motion is the only off switch: nothing moves, each state rests on its own eyes, and a change swaps them at once. Curves are `--ease-fluid` (loops), `--ease-spring`, `--ease-settle` and `--ease-stretch`.

## Rules

- `data-shape`, `data-grid` and `data-eyes` on the character's `<svg>` name the drawing for screenshots and checks.
- Photo and icon avatars keep the round disc they always had. A character never sits on a disc.
- A character wears no ring: its eyes carry the state. A photo or icon has no eyes, so it wears the Working ring (`--live`, breathing) while its agent works and the still Needs you ring (`--needs`) while it waits on you.
- Nothing sits on a character's face. The avatar mark's Needs you diamond and failed dot sit after the faces, and a phone row's status mark beside its avatar.
- An agent mention pill tints the agent's color behind its name (45% in light, 30% in dark, `AGENT_PILL_TINT`), with the 16px avatar at its start, so the name in the text color reads at 4.5:1 or more on every agent color. A selected pill keeps the tint and takes an inset 1.5px ring in the text color; its focus ring is the text color too.
