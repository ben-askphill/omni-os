AgentIdentity is the Identity block at the top of an agent's page in Settings > Agents and of the New agent dialog, on desktop web, phone web and the desktop app (`AgentIdentity` in `apps/web/src/components/AgentIdentity.tsx`, its rules in `packages/shared/agent-identity.ts`, ADR 0021). It is the one place an agent's avatar is set. The iOS app has no agent editing. It is composed of existing parts: `AgentAvatar`, `Segmented`, `Button`, `.field`, `AvatarColorPicker` (with `preview={false}`, since the block draws the avatar itself, the agent palette as its swatches and the shape's paired color as `auto`) and `ErrorNote`, inside the settings `Card`, plus the shape picker's tiles.

```jsx
<AgentIdentity
  id="builder" name="Builder"
  value={{ style: 'character',   // photo and svg are both the Upload source
    stash: { emoji: '', glyph: '', svg: '' },
    shape: '',                    // a crew shape id, empty for the one its id picks
    bg: '',                       // empty: the shape's paired color
    picked: null }}
  onChange={setIdentity}
  saved={role.avatar?.image}     // the uploaded image's URL, kept by the Photo style
  offered={role.server?.avatarOffered}
  fields={<>{name}{id}{description}</>}
/>
```

## Layout

- **Preview** on the left, 132px wide (above the fields on the phone): the avatar at 88px; a 20px sample on a `bg` pill with the agent's name, as a reply's author line draws it; an 18px sample with its name, as a rail row draws it; for a character, its six eye states still at 32px (idle, thinking, working, waiting, needs you, done), three to a row, six in one row on the phone; then an 11.5px `fg-3` line saying where the face comes from: "Its crew character." for a built-in in its own shape and color, "A crew character from its id." for any other agent's default, else the shape and color by name ("A fan in Teal.", "A squircle in a custom color."), and for the other sources "Your SVG on its color." and the like. A photo picked but not saved puts a `--live` dot on the big avatar's corner.
- **Fields** on the right: Name, Id (New agent only) and Description, the editor's usual stacked `Label` rows.
- **Avatar**: a small `Segmented` with four sources, one choice: Character, Emoji, Icon, Upload. Character comes first and is where every agent starts unless it has an emoji, an SVG or a photo. Picking one replaces the others; the preview is always what shows.
- **The source's panel** under it. Character: the **Shape** picker, a Default tile (the shape its id picks) and the 16 crew shapes, each drawn at 24px in its paired color on a 66 × 56px tile with a 10px `fg-3` note under it: Built-in on the agent's own built-in shape, the name of another agent that shows the shape ("Writer", "Writer +1" for more, all of them in the tile's name), or nothing. The checked tile takes `surface-2` and a 1.5px `fg` inset ring; the others wash `surface-2` on hover. The tiles wrap: eight to a row on the desktop page, four at 390px. Upload has Upload image or SVG, then Replace (and Undo for a photo picked, not saved), with a note on both kinds: a PNG, JPEG or WebP fills the circle, an SVG sits on the color; Emoji a 20px centered `.field` that keeps one grapheme; Icon the shared glyph grid as 36px round radios.
- **Color**: `AvatarColorPicker` with the 14 agent colors, for Character, Emoji, Icon and an uploaded SVG, hidden for a photo, which fills the circle. An SVG adds its sampler.

## Behaviour

- The shape picker is one radio group with one Tab stop (`useRovingFocus`, `stop: 'selected'`): Tab lands on the checked tile, the arrow keys, Home and End move and pick, wrapping at the ends.
- Reset to auto clears the color, so the character takes its shape's paired color again; with a shape picked, the pair follows the new shape.
- Nothing saves on its own: the style, the icon, the shape, the color and a picked photo go with the editor's Save as `avatar: { icon, shape, bg }`, and the save bar says Unsaved changes.
- Each source keeps what it was given while another is tried, so switching back finds it. The shape stays in the file under an icon or emoji, which shows instead.
- Saving any source but a photo upload removes an uploaded image (`PUT /api/crew/:id/avatar` with `null`), so a photo never hides what the preview shows.
- The big avatar sits in a wrapper whose `data-crew-pop` changes with what it shows, its shape and its color: the agent-switch pop plays there, apart from the avatar's own loops.
- Hidden while the editor shows the file (Advanced > Edit as Markdown).
