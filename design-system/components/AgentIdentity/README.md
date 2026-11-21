AgentIdentity is the Identity block at the top of an agent's page in Settings > Agents and of the New agent dialog, on desktop web, phone web and the desktop app (`AgentIdentity` in `apps/web/src/components/AgentIdentity.tsx`, its rules in `packages/shared/agent-identity.ts`). It is the one place an agent's avatar is set. It is composed of existing parts: `AgentAvatar`, `Segmented`, `Button`, `.field`, `AvatarColorPicker` (with `preview={false}`, since the block draws the avatar itself) and `ErrorNote`, inside the settings `Card`.

```jsx
<AgentIdentity
  id="builder" name="Builder" builtInMark
  value={{ style: 'svg',   // photo and svg are both the Upload source stash: { emoji: '', glyph: '', svg: 'svg:<svg …>' }, bg: '#283c62', picked: null }}
  onChange={setIdentity}
  saved={role.avatar?.image}     // the uploaded image's URL, kept by the Photo style
  offered={role.server?.avatarOffered}
  fields={<>{name}{id}{description}</>}
/>
```

## Layout

- **Preview** on the left (above the fields on the phone): the avatar at 88px, then a 20px sample on a `bg` pill with the agent's name, as a reply's author line draws it, then a 11.5px `fg-3` line saying where the face comes from ("Your SVG on its color.", "Its built-in mark."). A photo picked but not saved puts a `--live` dot on the big avatar's corner.
- **Fields** on the right: Name, Id (New agent only) and Description, the editor's usual stacked `Label` rows.
- **Avatar**: a small `Segmented` with four sources, one choice: Initials (Built-in for an agent with a mark), Emoji, Icon, Upload. Picking one replaces the others; the preview is always what shows.
- **The source's panel** under it: Upload has Upload image or SVG, then Replace (and Undo for a photo picked, not saved), with a note on both kinds: a PNG, JPEG or WebP fills the circle, an SVG sits on the color; Emoji a 20px centered `.field` that keeps one grapheme; Icon the shared glyph grid as 36px round radios; Initials or Built-in one line on what it shows.
- **Background**: `AvatarColorPicker` for Initials, Emoji, Icon and an uploaded SVG, hidden for a photo, which fills the circle. An SVG adds its sampler.

## Behaviour

- Nothing saves on its own: the style, the icon, the color and a picked photo go with the editor's Save, and the save bar says Unsaved changes.
- Each source keeps what it was given while another is tried, so switching back finds it.
- Saving any source but a photo upload removes an uploaded image (`PUT /api/crew/:id/avatar` with `null`), so a photo never hides what the preview shows.
- Hidden while the editor shows the file (Advanced > Edit as Markdown).
