---
name: pr-writer
description: Use when creating, opening or editing a pull request in any repo, running `gh pr create` or `gh pr edit`, asked to "write a PR description", "open a PR" or "draft the PR body", or finishing a branch that will be merged through a PR.
---

# PR writer

Ben's house style for pull request titles and descriptions. Based on the examples Wiebe collected (sources in `references/style-sources.md`).

Core rule: a reviewer should know what changed, why, and how to check it within 10 seconds of opening the PR. A few lines of prose, some bullets, visuals if they help.

## 1. Gather facts first, never guess

Run these before writing a word:

```bash
BASE=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)   # or the PR's actual base
git log --oneline "$BASE"..HEAD
git diff --stat "$BASE"...HEAD
git diff "$BASE"...HEAD            # read it; skim lockfiles and generated files
ls .github/pull_request_template.md .github/PULL_REQUEST_TEMPLATE/ 2>/dev/null
git log --oneline -20 "$BASE"      # title convention used in this repo
```

Also collect: the ticket or issue key (branch name, commits, task brief), what you actually ran to test it and the result, CI status if known, screenshots you took.

Write only what the diff, commits and your own test runs support. If something wasn't tested, say so.

## 2. Title

- Follow the repo's existing convention (check `git log`). If it uses Conventional Commits: `type(scope): summary`.
- Put the ticket key right after the prefix when there is one: `feat(storefront): SPOC-1768 add long description block to Black Tie page`.
- Summary is a lowercase imperative phrase, describes the outcome, no trailing period, under ~72 chars.

## 3. Body: the shape

```markdown
<One or two sentences: what changes, in the reader's terms, and why. Verb first: "Adds", "Fixes", "Moves".>

- <One behaviour change per bullet. What it does now, not which file changed.>
- <2 to 5 bullets. Skip the list if the opening sentence already covers it.>

<Scope note if any: "X will be in a separate PR." / "TODO for <team>: ...". Omit if none.>

[Screenshot: <what it shows>]   <- only for visible changes; label each one

### Testing                      <- only when a reviewer needs steps to verify
1. <Action, with link to preview/staging if there is one.>
2. <What they should see.>

Tested <where/how> with `<exact input>`. <What actually happened.>
<CI line: "Tests, lint and TypeScript pass. <Anything failing and why.> No tests added." >

Closes #<n> / <TICKET-123>       <- if there is an issue or ticket

<attribution footer, if the harness supplied one>
```

Scale length to risk. A copy or config change can be a single sentence with no headings. Add a Testing section when the reviewer has to do something to verify, and drop it when there is nothing for them to do.

## 4. Do / don't

Do:
- Explain the why in the same sentence as the what ("so eCom Ops can publish SEO copy themselves").
- Describe behaviour, not files. "Preserves locale across search, cart and account flows", not "edited `cart.ts`".
- Name what is deliberately out of scope and any loose ends (TODOs, props not wired up yet).
- Give exact test inputs and observed results, not "tested and works".
- Report CI honestly, including failures and missing tests.
- Wrap code, paths, env vars and commands in backticks.

Don't:
- Use boilerplate headings with nothing behind them (`## Summary`, `## Changes`, `## Type of change`).
- List every file or narrate how you got there.
- Leave a template's instructions, HTML comments or unticked irrelevant boxes in the body.
- Write em dashes or double dashes, emojis, or jargon ("leverage", "robust", "seamless", "enhance").
- Claim tests, screenshots or checks you didn't run.

## 5. Repo PR templates win on structure

If `.github/pull_request_template.md` (or a file in `.github/PULL_REQUEST_TEMPLATE/`) exists, keep its headings and order and fill each section in this style. Put the opening sentence and bullets under its summary/description heading. Write "n/a" for a section that doesn't apply rather than deleting a required heading. Tick only checkboxes that are true. Remove the template's guidance comments.

The repo's own instructions (CLAUDE.md, AGENTS.md, CONTRIBUTING.md) also win where they conflict with this skill, e.g. a required screenshot upload script or a PR checklist.

## 6. Footer

If the harness or system prompt specifies a PR attribution footer (Claude Code's "🤖 Generated with [Claude Code](https://claude.com/claude-code)" line), append it exactly as given as the last line, after one blank line. It is the one allowed exception to the no-emoji rule. Add no other sign-off.

## 7. Create or edit

Pass the body through a file or heredoc so markdown and backticks survive:

```bash
gh pr create --base "$BASE" --title "<title>" --body-file - <<'EOF'
<body>
EOF
gh pr edit <n> --body-file - <<'EOF'   # editing: re-read the current body and diff first
<body>
EOF
```

When editing a PR, rewrite the whole body against the current diff instead of appending a changelog.

## Examples

Small change (#7488 style):

```markdown
feat(storefront): SPOC-1768 add long description block to Black Tie Package page

Adds the Long description field that collection and store pages already have to the Black Tie Package landing page, so eCom Ops can publish SEO and FAQ copy there themselves. It renders at the bottom through the existing `SeoBlock` and stays hidden for locales with no content.
```

Change that needs QA (#7956 style, condensed):

```markdown
Add authentication to check-in

Adds Customer Hub's login flow to check-in and keeps all URL parameters after login. Logs `{accountNumber, env, authToken}` with a TODO for the check-in team. The component doesn't use these props yet.

### Testing
1. Open the [preview](<url>) signed out and log in with your email code.
2. Check you return to check-in with the same URL parameters.
3. Look for `Check-in props` in the console. It should hold your account number, environment and token.

Tested in Chrome with `/en-us/check-in?store-id=123&test=a%26b&test=second&empty=`. After login the browser returned to that exact path. Both `test` values, the encoded `&` and the empty value were kept.

Tests, lint and TypeScript pass. SonarCloud fails on coverage and duplicated code. No tests added.
```
