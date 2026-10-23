"""Turn RouterBench's 0-shot pickle into the JSONL route-eval.ts reads.

uv run --with pandas python -I export_routerbench.py routerbench_0shot.pkl routerbench.jsonl
Source: https://huggingface.co/datasets/withmartian/routerbench (Hu et al. 2024, arXiv:2403.12031).
"""
import ast
import json
import sys

import pandas as pd

MODELS = {
    "light": "mistralai/mixtral-8x7b-chat",
    "standard": "gpt-3.5-turbo-1106",
    "heavy": "gpt-4-1106-preview",
}


def text(raw):
    try:
        parts = ast.literal_eval(raw)
        return "\n\n".join(parts) if isinstance(parts, list) else str(parts)
    except (ValueError, SyntaxError):
        return raw


src, dst = sys.argv[1], sys.argv[2]
df = pd.read_pickle(src)
with open(dst, "w") as out:
    for _, r in df.iterrows():
        out.write(json.dumps({
            "id": r["sample_id"],
            "eval": r["eval_name"],
            "prompt": text(r["prompt"]),
            "score": {t: float(r[m]) for t, m in MODELS.items()},
            "cost": {t: float(r[f"{m}|total_cost"]) for t, m in MODELS.items()},
        }, ensure_ascii=False) + "\n")
print(f"wrote {len(df)} rows to {dst}")
