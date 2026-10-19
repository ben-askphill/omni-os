# Style sources

Source: Notion page "PR Examples" by Wiebe (Ask Phill), under Projects / Suitsupply.
https://app.notion.com/p/ask-phill/PR-Examples-3fa5f3547352811e99b6ea6ba9926592

Wiebe's framing: "concise and include the right details", "very few lines of prose, some bullet points and visuals if needed. Makes it scannable for easily distracted brains."

The page quotes four PRs from `Suitsupply/monorepo`. The original GitHub PRs were not reachable with Ben's `gh` account (repo not visible), so the patterns come from the descriptions as quoted in Notion.

## Pattern to source

| Pattern | Source |
|---|---|
| Conventional Commit title, `type(scope): summary` | #7251 `fix(sanity): ...`, #7488 `feat(shopify-storefront): ...` |
| Ticket key in the title, after the prefix | #7488 `SPOC-1768`, #6713 `SPOC-1595` |
| Plain imperative title is fine when the repo doesn't use prefixes | #7956 "Add authentication to check-in" |
| One-sentence opening, verb first, what changed | #7251 "Fix country preview resolution...", #6713 "Improves storefront market and locale handling." |
| Why folded into the same sentence as the what | #7488 "...so eCom Ops can publish SEO/FAQ copy there themselves" |
| 2 to 3 bullets, each one behaviour change, no file names | #7251 (2 bullets), #6713 (3 bullets) |
| Whole description can be a single sentence when the change is small | #7488 |
| Out-of-scope work named explicitly | #6713 "Buyer identity will be in a separate PR." |
| Loose ends and handoffs named | #7956 "TODO for the check-in team", "The component doesn't use these props yet." |
| Screenshots placed after the bullets, each labelled with what it shows | #7251 (three labelled screenshots) |
| Testing section: numbered steps, preview link, expected result per step | #7956 |
| Local setup: link to README plus the exact command and env var | #7956 `OXYGEN_REDIRECT_DISABLED=true`, `pnpm nx run ...` |
| Exact input tested and the observed result, not "works" | #7956 query string with `a%26b`, empty value, reload check |
| Honest CI line, failures and missing tests included | #7956 "Tests, lint and TypeScript pass. SonarCloud fails on coverage and duplicated code. No tests added." |
| Code, env vars, paths and component names in backticks | #7956, #7488 `SeoBlock` |

## What all four leave out

- `## Summary` / `## Changes` / `## Type of change` boilerplate headings
- File-by-file changelogs or implementation narrative
- Checklists, emojis, marketing language
- Any heading at all unless there is a Testing section (#7956 is the only one with a heading)
