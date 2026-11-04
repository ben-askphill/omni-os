repo: ben-askphill/omni-os
branch: main
path: apps/web/src
also: apps/mac/Omni

## Last sync
date: 2026-10-20T19:12:06Z

### Updated in this project
- Source moved upstream from web/src to apps/web/src (monorepo); paths updated
- New tokens from index.css: --chrome #0c0d0f, --bg-sidebar, --warn, --diff-add, --diff-del, --mark, --bubble
- Sidebar (Rail) now draws dark in both schemes (.scheme-dark), app shell gutters use --chrome
- Mac app (apps/mac/Omni, SwiftUI) read in full for ui_kits/mac/Mac Design System.html

## Screen map
| Project screen / component | Repo files |
| --- | --- |
| tokens/*.css | apps/web/src/index.css, apps/mac/Omni/Theme.swift |
| components/core, components/forms | apps/web/src/components/ui/*.tsx |
| components/navigation/Rail | apps/web/src/components/Sidebar.tsx, apps/web/src/components/theme.tsx |
| components/navigation/CommandPalette | apps/web/src/components/CommandPalette.tsx |
| components/thread/ThreadRow | apps/web/src/components/ThreadList.tsx |
| components/thread/Message, ToolCall, CrewReport | apps/web/src/components/Transcript.tsx |
| components/thread/Composer | apps/web/src/components/Composer.tsx |
| components/feedback/Toast | apps/web/src/components/Toaster.tsx |
| ui_kits/omni-os/App.jsx (shell) | apps/web/src/App.tsx |
| ui_kits/omni-os/ChannelScreen.jsx | apps/web/src/pages/Channel.tsx, apps/web/src/components/ThreadList.tsx |
| ui_kits/omni-os/ConductorScreen.jsx | apps/web/src/pages/Thread.tsx, apps/web/src/components/Transcript.tsx |
| Mac OS Design System.html | apps/mac/Omni/*.swift (Theme, ScreenStyle, ThreadStyle, ComposerStyle, Brand, SidebarView, MessageViews, ToolViews, DelegationViews, InspectorTabs, ChangesTab, DiffView, PullRequest*, Settings*, …) |

## Sync history
- 2026-09-28T09:01:31Z — fonts to SF stacks; neutrals, radii, shadows, heights, easings from index.css + ui.tsx; Bencho blocks; sidebar/thread/composer/⌘K density
