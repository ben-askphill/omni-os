---
name: omni-os-design
description: Use this skill to generate well-branded interfaces and assets for Omni OS, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the readme.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

Key rules (details in readme.md and guidelines/principles.html):
- Pure white base; Bencho greys (surface, surface-2, surface-3) for cards and pills inside it. Ultramarine = running, vermilion = needs you, volt = done. Color means status only; no tinted washes, no per-channel hue.
- SF Pro / SF Mono / SF Pro Rounded (system stacks, never served as webfonts). Body 14, markdown 14.5, UI 13, meta 11, captions 12 medium, sentence case — no all-caps or mono labels. SF Mono only for code: ids, branches, commits, paths, filenames.
- Rounded and pill-first (6 → 28px radii). Heights from the web app: nav 32, buttons 28/34/44, palette rows 48.
- Bencho interactions: hover wash springs in, press scales to .96, sliding thumbs stretch then settle; inline confirm with undo, slide to confirm, picker, checklist, ticks, toast.
- Only agents move on their own (the fluid mark, running ping). Attention is still.
- No gradients, shimmer text, glass/blur, sparkle icons, emoji.
