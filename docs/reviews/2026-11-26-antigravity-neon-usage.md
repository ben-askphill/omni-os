# Antigravity Neon usage, measured (2026-11-26)

Neon threads use up the Antigravity 5-hour and weekly Gemini allowances quickly. The brief was to cut a Neon task's usage by 75% without making results worse. This review measures where the usage goes. Omni's own share is too small to reach 75%. Only a model or effort change gets close, so the choice is Ben's.

## How it was measured

- The task: a three-turn researcher thread on a QA stack running the real `agy` 1.5.18 (`scripts/antigravity-usage-bench.mjs`). Turn one reads three call notes, turn two reads a CSV and turn three drafts a Slack reply. Each run is a new thread with the Researcher agent, on main as of `0513f273`.
- The numbers come from agy's own record of each model call: `~/.gemini/antigravity-cli/conversations/<session>.db`, table `gen_metadata`. For every call it holds the prompt tokens sent fresh, the prompt tokens read from cache, and the output tokens, thinking included. The ACP `usage_update` only gives the window size, so it cannot split these.
- Cost weights, in units of one fresh input token: cached read 0.05, output 5. They come from `/usage` deltas of single-call Neon probes. A 23k-token uncached prompt cost 0.23% of the 5-hour allowance. 14k output tokens on top of 93k input cost 0.70%. A second call that read 20k tokens from cache added almost nothing. Gemini 3.8 Flash costs about 3.9x less than Neon per token (0.059% against 0.231% of the 5-hour allowance for the same 23k prompt).
- `/usage` is account-wide and its reads jump around (0.7449, then 0.7505, then 0.7449 with nothing running). It cannot measure a run this small. The token counts are the measure; the allowance deltas are a rough cross-check only.

## Baseline

| Run | Model calls | First prompt | Fresh in | Cached in | Output (thinking) | Cost units |
|---|---|---|---|---|---|---|
| Neon, default effort (high), run 1 | 5 | 27,983 | 44,344 | 134,252 | 6,232 (5,462) | 82,217 |
| Neon, default effort (high), run 2 | 6 | 27,968 | 41,048 | 152,872 | 4,374 (3,624) | 70,562 |
| **Baseline mean** | | | | | | **76,390** |

Run 1 used about 1.0% of the 5-hour allowance and 1.0% of the weekly one, which matches the token cost (about 0.8% of the 5-hour allowance). So the bucket holds roughly a hundred of these small tasks.

What run 1's cost is made of:

- Fresh prompt tokens: 44,344 units (54%). The first call alone is 27,983 (34% of the task).
- Thinking: 27,310 units (33%).
- Reply and tool-call text: 3,850 units (5%).
- Cached prompt reads: 6,713 units (8%).

What the 28k-token first prompt is made of:

- agy's own system prompt and built-in tools: about 11.2k. This was measured in print mode with no skills.
- The index of skills in `~/.gemini/antigravity-cli/skills` and `~/.agents/skills` (167 skills): 6.7k on the bench. This was measured by running the same thread on a home with no skill folders. In print mode, with the built-in plugins as well, it is 12.2k.
- Omni's system prompt: about 2.6k (10.3k characters on the stack; 13.5k to 14k characters on Ben's live threads).
- The rest is Omni's MCP servers (agy loads their tools lazily, so it lists names and descriptions), the workspace folders and the message: about 7.5k, worked out by difference.

## Ben's real Neon threads

agy's records of 14 Omni Neon threads from 2026-11-25 and 2026-11-26 add up to 327 model calls and 8.5M cost units.

| Share of the cost | |
|---|---|
| Cached prompt reads (the context re-read on every call) | 30% |
| New tokens per call (tool output, mostly `read_file` and `run_command`) | 28% |
| Reply and tool-call text (builders write whole edits) | 18% |
| Thinking | 17% |
| First-call prompts | 6% |
| Cache misses between turns | 1% |

- Builder threads (#1006 to #1011 and the context audit) are 73% of that cost. They make 26 to 49 model calls per turn, and their context grows from 36k to 200k-380k tokens by the end of the turn.
- Omni's injected prompt and the skill index are each about 4% of the real spend. Omni's own MCP tool output is under 1%: almost all tool output is agy's `read_file` and `run_command`.
- Sessions stay warm: there was one cache miss in 327 calls, so no resends or re-created sessions. Calls that only update agy's checklist (`update_steps`) are about 4%.

Raising the context compaction threshold (`AGY_CLI_AUTO_COMPACT_OVERRIDE`, for example 150K), simulated on the same threads, saves about 10% and summarises the work earlier.

## Options

| Option, measured on the bench | Cost units | Change | Tradeoff |
|---|---|---|---|
| Neon at effort medium | 58,634 | -23% | Less thinking on hard work |
| Neon at effort low | 50,585 | -34% | More so |
| Neon with no home skills | 61,136 | -20% | Neon no longer sees Ben's 167 skills (APA skills, pr-writer and others) unless a repo carries them |
| Neon with no home skills, at effort low | 44,927 | -41% | Both of the above |
| Gemini 3.8 Flash, default effort | 68,952 tokens-weighted, about 17,700 in Neon units | -77% | A smaller model |

- All seven runs gave correct answers: Italy as default, decided 2026-11-03; Romania ruled out 2026-10-16; 22% VAT; free shipping from EUR 90. The task is too easy to show a quality gap, so these numbers only say the cheaper setups did not break it.
- Without a model change, the levers top out around -41% on a small task. They do less on builder threads, where the base prompt is a small part of a 200k context.
- agy's Claude Opus 5.5 and Sonnet 5.5 count against a separate allowance, which was untouched at 100% on 2026-11-26. They do not lower Gemini usage, but they move work off it.
- No Omni-side change gets near 75%. Trimming Omni's system prompt or MCP list on Antigravity is worth a few percent at most.

## Recommendation

1. Researcher and Writer agents on Antigravity default to Gemini 3.8 Flash. On the bench this is the one change that reaches 75%, and the answers were the same.
2. Neon stays for Builder work, at effort medium by default instead of agy's high (-23% on the bench; thinking is 17% of builder spend).
3. Keep the skills. Hiding them saves about 4% of real spend and drops capabilities Ben's prompts point to.

On Ben's mix this would save about a third of today's Neon spend. That is not 75%, because builders are most of the spend. Reaching 75% overall would also need builders off Neon: Flash, or Claude through agy's separate allowance.

## Re-running it

```sh
QA_SERVER_PORT=4791 QA_NO_WEB=1 QA_BROWSER=1 QA_ANTIGRAVITY_BIN=$(command -v agy) scripts/qa-stack.sh up --seed 0
QA_SERVER_PORT=4791 node scripts/antigravity-usage-bench.mjs baseline gemini-4-neon
QA_SERVER_PORT=4791 node scripts/antigravity-usage-bench.mjs medium gemini-4-neon medium
QA_SERVER_PORT=4791 scripts/qa-stack.sh down
```

Each Neon run spends about 1% of the 5-hour allowance. The script's header lists the agy record fields it reads. They are not documented and may move in a later agy.
