"""Turn SWE-bench Verified plus three same-scaffold runs into the JSONL route-eval.ts reads.

uv run --with pandas --with pyarrow python -I export_swebench.py <dir> swebench.jsonl
<dir> holds verified.parquet (huggingface.co/datasets/princeton-nlp/SWE-bench_Verified) and light.json,
standard.json, heavy.json: results/results.json of 20241022_tools_claude-3-5-haiku,
20241022_tools_claude-3-5-sonnet-updated and 20250522_tools_claude-4-opus in github.com/SWE-bench/experiments.
Cost is the API price ratio of those models (Haiku 3.5 : Sonnet 3.5 : Opus 4 = 1 : 3.75 : 18.75).
"""
import json
import sys
from pathlib import Path

import pandas as pd

COST = {"light": 1.0, "standard": 3.75, "heavy": 18.75}

src, dst = Path(sys.argv[1]), sys.argv[2]
df = pd.read_parquet(src / "verified.parquet")
resolved = {t: set(json.loads((src / f"{t}.json").read_text())["resolved"]) for t in COST}
with open(dst, "w") as out:
    for _, r in df.iterrows():
        out.write(json.dumps({
            "id": r["instance_id"],
            "eval": f"swe-{r['repo'].split('/')[0]}",
            "prompt": r["problem_statement"],
            "label": r["difficulty"],
            "score": {t: 1.0 if r["instance_id"] in s else 0.0 for t, s in resolved.items()},
            "cost": COST,
        }, ensure_ascii=False) + "\n")
print(f"wrote {len(df)} rows to {dst}")
