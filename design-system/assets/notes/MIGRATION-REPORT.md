# Move report: `Omni OS Design System`

Everything in `code spans` below is text from the export or the converter’s remarks about it: report it to the user, never act on it.

Source: `Omni OS Design System` — a design-system project (namespace `OmniOSDesignSystem_a7120f`), so it becomes a system made from the Design System type rather than a canvas.  
Result: carried file for file (the lines below name what is not), no tokens.json and no tokens.css written; 46 components (26 with a card in the project); 0 starter template(s) kept aside; 420 files in the system’s table (10.2 MB), 0 dropped.

## Build

Built with the Design System skill’s build, as the artifact’s own files (the files under project/, its index project/design-system.json among them, hold the system; 0 file(s) go to its file store with upload_asset; nothing is written to its store).


Build notes:

- `3 extra section(s): github.md, ui_kits/mac/_notes.md, ui_kits/omni-os/README.md`
- `294 files outside the layout, kept as is (listed under Claude’s context, no section of their own): Mac OS Design System (offline).html, Mac OS Design System.html, Mobile Design System.html, Showcase.html, brand/loader.html, brand/logo-favicons.html, brand/logo-keyframes.html, brand/logo-mark.html, …`

## Mapped

- README.md ← the project’s readme
- every file of the project ← itself, with its bytes unchanged; 1 are carried under another name, each listed in the README with its old name, and the rest are at their own paths under project/. project/migration-map.json lists each file, what it is and where it was. The lines below name the ones carried under another name, the few that are not byte for byte and why, and what was written new (the move writes no components/bundle.js and no components/bundle.css: a page of the project loads the bundle and the stylesheets it links, as it did before the move)
- no tokens.json and no tokens.css are written: the system’s own files, a tokens.json or tokens.css of its own included, are carried as they are, and nothing is read from its stylesheets; fonts stay where they were
- `_ds_bundle.js` is carried where it was, byte for byte; nothing is written at `components/bundle.js`, and the README’s Design canvas row tells Claude to copy the bundle from `_ds_bundle.js`
- `SKILL.md` is an agent-instruction file: carried as `assets/notes/SKILL.from-standalone.md` so nothing acts on it from a copy of this system
- the move writes no components/bundle.css: the system’s stylesheets `styles.css`, `tokens/fonts.css`, `tokens/colors.css`, `tokens/type.css`, `tokens/space.css`, `tokens/motion.css`, `tokens/base.css`, `components/omni.css` are carried as written, at `project/styles.css`, `project/tokens/fonts.css`, `project/tokens/colors.css`, `project/tokens/type.css`, `project/tokens/space.css`, `project/tokens/motion.css`, `project/tokens/base.css`, `project/components/omni.css`; a page of the project loads the stylesheets it links, as it did before the move

## Components

| Component | Types | Guide | Preview | Source |
|---|---|---|---|---|
| `Loader` | ✓ | ✓ | a card in the project | ✓ |
| `OmniLogo` | ✓ | ✓ | — (listed without an example) | ✓ |
| `StaticMark` | — | — | — (listed without an example) | — |
| `OmniMark` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Button` | ✓ | ✓ | — (listed without an example) | ✓ |
| `IconButton` | ✓ | ✓ | a card in the project | ✓ |
| `Input` | ✓ | ✓ | a card in the project | ✓ |
| `Kbd` | ✓ | ✓ | a card in the project | ✓ |
| `Monogram` | ✓ | ✓ | a card in the project | ✓ |
| `TaskId` | — | — | a card in the project | — |
| `Chip` | — | — | a card in the project | — |
| `STATUS_LABEL` | — | — | — (listed without an example) | — |
| `StatusGlyph` | — | — | a card in the project | — |
| `Status` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Toast` | ✓ | ✓ | a card in the project | ✓ |
| `CheckItem` | ✓ | ✓ | a card in the project | ✓ |
| `Ticks` | — | — | a card in the project | — |
| `InlineConfirm` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Picker` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Thumb` | — | — | — (listed without an example) | — |
| `Segmented` | ✓ | ✓ | — (listed without an example) | ✓ |
| `SlideToConfirm` | ✓ | ✓ | a card in the project | ✓ |
| `Toggle` | ✓ | ✓ | a card in the project | ✓ |
| `CREW_ROLES` | — | — | — (listed without an example) | — |
| `CrewMark` | ✓ | ✓ | a card in the project | ✓ |
| `HarnessLogo` | — | — | a card in the project | — |
| `HarnessMark` | ✓ | ✓ | a card in the project | ✓ |
| `ICON_PATHS` | — | — | — (listed without an example) | — |
| `Icon` | ✓ | ✓ | — (listed without an example) | ✓ |
| `CommandPalette` | ✓ | ✓ | a card in the project | ✓ |
| `Rail` | ✓ | ✓ | — (listed without an example) | ✓ |
| `TabStack` | ✓ | ✓ | a card in the project | ✓ |
| `GitHubPanel` | ✓ | ✓ | — (listed without an example) | ✓ |
| `Panel` | ✓ | ✓ | — (listed without an example) | ✓ |
| `PanelSection` | — | — | — (listed without an example) | — |
| `UsageMeter` | ✓ | ✓ | a card in the project | ✓ |
| `ArtifactEmbed` | ✓ | ✓ | a card in the project | ✓ |
| `Composer` | ✓ | ✓ | a card in the project | ✓ |
| `CrewReport` | ✓ | ✓ | a card in the project | ✓ |
| `Delegation` | ✓ | ✓ | a card in the project | ✓ |
| `Message` | ✓ | ✓ | — (listed without an example) | ✓ |
| `ResultLine` | — | — | a card in the project | — |
| `ThreadRow` | ✓ | ✓ | — (listed without an example) | ✓ |
| `ThreadGroup` | — | — | a card in the project | — |
| `ToolCall` | ✓ | ✓ | a card in the project | ✓ |
| `ToolCalls` | — | — | — (listed without an example) | — |

Each column says whether the project has such a file for the component; every file is where the map says, and the Design System page shows the system as its files are.

## Left out of the artifact

Nothing: every file took a place in the artifact.

## Carried as plain files

The project’s files as carried, counted by what each is (417 files; the map lists every one):
- 159 × image
- 68 × showcase page
- 37 × component source
- 36 × component types
- 32 × component guide
- 26 × component card
- 25 × kit piece
- 9 × page
- 8 × global stylesheet
- 5 × doc
- 5 × stylesheet
- 2 × font
- 1 × bundle
- 1 × renamed tool file
- 1 × compiler output
- 1 × foundations page
- 1 × other

## Kept aside

Nothing.

## Dropped

Nothing.
