#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p benchmark/results

set_env_kv() {
  local key="$1" value="$2"
  if rg -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    echo "${key}=${value}" >> .env
  fi
}

wait_ready_model() {
  local expected="$1" timeout_s="$2"
  local start now out
  start=$(date +%s)
  while true; do
    out=$(curl -fsS http://localhost:8000/v1/models 2>/dev/null || true)
    if echo "$out" | rg -q "$expected"; then
      return 0
    fi
    now=$(date +%s)
    if (( now - start >= timeout_s )); then
      return 1
    fi
    sleep 2
  done
}

run_one() {
  local slug="$1" model="$2" max_len="$3" max_seqs="$4" gpu_util="$5" timeout_s="$6"
  local t0 t1 startup state note
  echo "=== alt $slug :: $model ==="

  set_env_kv MODEL_NAME "$model"
  set_env_kv QUANTIZATION ""
  set_env_kv MAX_MODEL_LEN "$max_len"
  set_env_kv MAX_NUM_SEQS "$max_seqs"
  set_env_kv GPU_MEMORY_UTILIZATION "$gpu_util"

  t0=$(date +%s)
  docker compose up -d --force-recreate >/dev/null

  if wait_ready_model "$model" "$timeout_s"; then
    t1=$(date +%s)
    startup=$((t1-t0))
    state="ready"
    timeout 90s ./run-smoke-test.sh > "benchmark/results/${slug}_smoke.txt" 2>&1 || true
    timeout 900s python3 benchmark/run_benchmark.py --model qwen-local --max-tokens 180 --timeout 240 --out "benchmark/results/${slug}.json" > "benchmark/results/${slug}_benchmark_stdout.txt" 2>&1 || true
    if [ -f "benchmark/results/${slug}.json" ]; then
      note=$(python3 - <<PY
import json
p='benchmark/results/${slug}.json'
o=json.load(open(p))['overall']
print(f"ok; mean_tps={o['mean_tokens_per_s']}, mean_quality={o['mean_quality']}, mean_latency={o['mean_elapsed_s']}s")
PY
)
    else
      note="ready but benchmark json missing"
    fi
  else
    t1=$(date +%s)
    startup=$((t1-t0))
    state="failed"
    docker logs --tail 260 qwen-vllm > "benchmark/results/${slug}_failure.log" 2>&1 || true
    note=$(rg -n 'No available memory|out of memory|ValidationError|quantization|failed|RuntimeError|Traceback|Exception|connection reset' "benchmark/results/${slug}_failure.log" | head -n 4 | tr '\n' '; ' || true)
    note=${note:-"not ready within ${timeout_s}s"}
  fi

  printf "%s|%s|%s|%s|%s|%s|%s\n" "$slug" "$model" "$state" "$startup" "$max_len" "$max_seqs" "$note" >> /tmp/alt_rows.txt
  echo "DONE alt: $slug -> $state"
}

: > /tmp/alt_rows.txt
run_one "alt_qwen25_coder_3b" "Qwen/Qwen2.5-Coder-3B-Instruct" 4096 8 0.90 420
run_one "alt_deepseek_r1_qwen_1p5b" "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B" 4096 8 0.90 420
run_one "alt_gemma3_4b" "google/gemma-3-4b-it" 4096 4 0.90 480
run_one "alt_deepseek_r1_qwen_7b" "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B" 2048 1 0.90 600

{
  echo "| slug | model | status | startup_s | max_len | max_seqs | notes |"
  echo "|---|---|---:|---:|---:|---:|---|"
  cat /tmp/alt_rows.txt
} > benchmark/results/alternatives_summary.md
cat benchmark/results/alternatives_summary.md
