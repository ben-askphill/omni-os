# Templates

Each file here is one template: a skill for a common job that the `/` menu and the New sheet offer under Templates.
The file name is the slash name (`client-qa.md` runs as `/client-qa`). Omni reads these at each call, and a file
with the same name in `data/templates/` replaces the one here.

Frontmatter:

- `name`: the title the New sheet shows.
- `description`: one line for the menu.
- `argument-hint`: what to type after the name.
- `kind`: `quick` for a short answer in the thread, `task` for work that writes, runs or browses.
- `pack`: `core` ships on; `store` only shows once the Shopify pack is turned on in Settings > Threads.
- `skill` (optional): a harness skill that does this job better. When the thread's harness lists it, the message
  starts with that skill and the template's text goes with it.

The body is the instruction the agent gets. `$ARGUMENTS` becomes what was typed after the name.
Shipped templates name no person, company or client: `apps/desktop/scripts/stage.ts` refuses a build that does.
