# Link previews

A link in a reply shows as its tool's mark, its id and the title the tool gives it (`#7723 Fix the cart`, `29549 Localization setup`), on the web and the Mac app. A link with its own words keeps them and gains the mark; hovering shows the source, state and URL.

- `packages/shared/link-sources.ts` reads what a URL points at, `apps/server/links.ts` asks the source for the live title and state (`POST /api/links/resolve`, cached 10 minutes), and the marks come from `packages/shared/link-icons.ts` (regenerate with `npx tsx packages/shared/scripts/build-link-icons.ts`).
- Sources with an API lookup, and the secret each needs (global, or the channel's own, which wins):

| Source | Secret |
| --- | --- |
| GitHub | none, uses your `gh` login |
| Azure DevOps | `AZURE_DEVOPS_PAT` |
| Jira, Confluence | `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN` |
| Productive | `PRODUCTIVE_API_KEY` |
| Shopify admin links | `SHOPIFY_ACCESS_TOKEN` |
| Notion | `NOTION_TOKEN` |
| Linear | `LINEAR_API_KEY` |
| Figma | `FIGMA_TOKEN` |
| Slack | `SLACK_BOT_TOKEN` |
| GitLab (private) | `GITLAB_TOKEN` |
| Sentry, Asana, ClickUp | `SENTRY_AUTH_TOKEN`, `ASANA_TOKEN`, `CLICKUP_TOKEN` |
| Trello | `TRELLO_KEY`, `TRELLO_TOKEN` |

- No secret needed: YouTube, Loom and Vimeo (oEmbed), npm, public GitLab and Bitbucket PRs, claude.ai artifacts Omni published, and Google Docs shared by link. Notion, Figma, Linear, Confluence and Trello links fall back to the title in their URL.
- Google Drive, Miro, Canva, Vercel, HubSpot, Klaviyo, Stripe, DatoCMS, Prismic, SharePoint, Teams and others get their mark and what the URL says. Any other public page shows its `<title>`; private, loopback and link-local addresses are never fetched.
- Credentials only go to fixed API hosts (or a self-hosted GitLab named in `GITLAB_HOST`), with ids from a link checked before they go in a request path, and no redirects. The page-title fetch checks the address it connects to, so DNS rebinding cannot reach a private one.
- Without its secret a link reads "Work item 29549", and its tooltip names the secret to add.
