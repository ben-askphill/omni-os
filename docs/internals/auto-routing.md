# Auto routing

Auto picks a new thread's harness, model and effort from its first prompt (`apps/server/harness/auto.ts`). This page says what it rests on, how it was checked, and how to check it again. The user-facing account is in [Harnesses](../user/harnesses.md#auto).

## Shape

- `profileTask(prompt)` gives a kind (code, math, research, writing, ops, chat), a score from the brief's size and cues, and a tier: light (Haiku, low), standard (Sonnet, medium), heavy (Opus, high), max (Opus, xhigh).
- `routeTask(profile, catalog, usage)` maps the tier onto the catalog. Claude Code unless its 5h or 7d window is at 90% or refusing and Codex has room; ops stays on Claude Code. Never Cursor or Hermes: they bill outside the subscriptions.
- `resolveRun` returns `{ auto: true }` for model `"auto"` with no harness, or when the thread, role and channel set nothing. `openThread` then routes and stores `auto_reason`. `{ harness: 'cursor', model: 'auto' }` is Cursor's own model and is not Auto.
- The weights are data: `harness/auto-weights.json`, written by `scripts/route-eval/fit.ts`.

## What the benchmarks say

Two public benchmarks, each with per-prompt results for a cheap, a middle and a strong model. `scripts/route-eval/fetch.sh` downloads both at pinned revisions; `npm run route-eval -- <file> --split test` prints everything below. Halves are split by id hash; only the dev half is fitted.

- **RouterBench** (Hu et al. 2024, arXiv:2403.12031): 36,497 single-turn prompts, Mixtral 8x7B / GPT-3.5 / GPT-4 as light / standard / heavy.
- **SWE-bench Verified**: 500 GitHub issues with a human time-to-fix estimate, and the same Anthropic tool scaffold run with Claude 3.5 Haiku (40.6% resolved), 3.5 Sonnet (49.0%) and 4 Opus (73.2%).

Held-out halves, as of this change:

| Check | Result |
| --- | --- |
| Kind, RouterBench code (MBPP) | 98.0% of 197 |
| Kind, RouterBench math | 92.7% of 4,281 |
| Kind, RouterBench writing | 71.9% of 292 |
| SWE: Auto resolves | 74.9% at 0.94x the cost |
| SWE: always Opus resolves | 75.7% |
| SWE: time-to-fix AUC, scorer | 0.535 |
| SWE: time-to-fix AUC, Haiku judge | 0.652 |
| RouterBench: AIQ vs non-predictive | 0.675 vs 0.697 |

What follows from them:

- **Kind is reliable, difficulty is not.** Nothing in a prompt's text told the cheap model's wins from its losses better than chance: not keyword cues, not length, not a cue model fitted on either benchmark (the shipped scorer's tiers against the same tiers dealt at random: p = 0.17 on SWE's test half, 0.94 on its dev half). This matches LLMRouterBench (arXiv:2601.07206).
- **So code starts on the strong tier.** On SWE-bench the strong model resolves 76% against 51% and 40%, and a router cannot tell which issues the cheap ones would also solve. `KIND_LIFT` puts code on heavy; only an explicit cue (typo, rename, small) moves it to standard, and code never runs light.
- **Light is for the kinds where it holds up.** On RouterBench's summary and title sets the light model matches or beats the strong one (abstract2title 99% vs 100%; consensus_summary 69% vs 59%), so writing, quick questions and admin start light.
- **RouterBench AIQ is below the non-predictive line** because math goes up a tier (GSM8K: 52% light, 66% strong, at 24x the cost). Omni does not route QA traffic, so that trade stands.
- **Fitting cues on a benchmark teaches its format.** Fitted freely on RouterBench, "small change" pushed toward the strong model: it fires on HellaSwag text, where the strong model gains most. Fitted on SWE-bench, every issue is a bug report, so "debugging" says nothing there. `fit.ts` therefore tunes only the size weights (length, code identifiers), from the priors in `auto.ts`; each cue keeps its stated prior.

## Not taken

- **A Haiku judge** (`claude -p --model haiku` rating 1 to 10). It ranks SWE issues by time-to-fix better (AUC 0.652 against 0.535) but routed no better, since code goes to the strong tier either way, and every call takes about 3s before the thread can start, more under load. Worth another look if the cheaper tiers for code come back into play.
- **A model trained on RouterBench.** It would learn which benchmark a prompt came from, which is no use on Omni's briefs.

## Checking a change

1. `scripts/route-eval/fetch.sh` (RouterBench's pickle is checked against a pinned SHA-256 before it is opened).
2. From `apps/server`, after changing a cue or prior: `npm run route-fit -- <dir>/swebench.jsonl`, then commit `auto-weights.json`.
3. `npm run route-eval -- <dir>/swebench.jsonl --split test` and the same for `routerbench.jsonl`. Report the p-value with any quality gain; a gain without one is noise.
4. `--scores <file>` scores any other router from JSONL of `{id, difficulty}`.
