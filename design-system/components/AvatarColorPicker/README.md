Channel avatar background control, composed of the existing Avatar, field, Button and ErrorNote primitives. Used in channel settings on desktop web, phone web and Electron.

- A 56px live avatar, native color input, six-digit hex field and Reset to auto button wrap at phone widths.
- Standard swatches and literal SVG paint colors are 32px round buttons with an accessible color name, pressed state and selected outline.
- An uploaded SVG adds a 128px image sampler. Click a painted point to set a custom background. Transparent points show an ErrorNote. Palette buttons offer a keyboard alternative.
- Automatic colors use a full-size SVG background shape when present. Otherwise they choose a random swatch with WCAG contrast of at least 4.5 against the main foreground. Glyph ink adapts to the selected background. Emoji uses a dark outline proxy.
- Custom backgrounds survive avatar changes. Reset clears the manual flag. An unset background retains the existing neutral avatar.

Implementation: `apps/web/src/components/AvatarColorPicker.tsx`. Shared color logic: `packages/shared/avatar-color.ts`.
