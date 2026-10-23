#!/usr/bin/env bash
# Download RouterBench and SWE-bench Verified with three same-scaffold runs, and export both to the JSONL that
# route-eval.ts and fit.ts read. Needs curl and uv. Usage: scripts/route-eval/fetch.sh [dir] (default /tmp/omni-route-eval).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dir="${1:-/tmp/omni-route-eval}"
mkdir -p "$dir/swe"
runs=https://raw.githubusercontent.com/SWE-bench/experiments/main/evaluation/verified

[ -f "$dir/routerbench_0shot.pkl" ] || curl -fsSL -o "$dir/routerbench_0shot.pkl" \
  https://huggingface.co/datasets/withmartian/routerbench/resolve/main/routerbench_0shot.pkl
[ -f "$dir/swe/verified.parquet" ] || curl -fsSL -o "$dir/swe/verified.parquet" \
  https://huggingface.co/api/datasets/princeton-nlp/SWE-bench_Verified/parquet/default/test/0.parquet
curl -fsSL -o "$dir/swe/light.json" "$runs/20241022_tools_claude-3-5-haiku/results/results.json"
curl -fsSL -o "$dir/swe/standard.json" "$runs/20241022_tools_claude-3-5-sonnet-updated/results/results.json"
curl -fsSL -o "$dir/swe/heavy.json" "$runs/20250522_tools_claude-4-opus/results/results.json"

uv run -q --with pandas python -I "$here/export_routerbench.py" "$dir/routerbench_0shot.pkl" "$dir/routerbench.jsonl"
uv run -q --with pandas --with pyarrow python -I "$here/export_swebench.py" "$dir/swe" "$dir/swebench.jsonl"
echo "npm run route-eval -- $dir/swebench.jsonl --split test"
echo "npm run route-eval -- $dir/routerbench.jsonl --split test"
