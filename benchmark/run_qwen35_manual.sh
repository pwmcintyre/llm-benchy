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
  local slug="$1" model="$2" quant="$3" max_len="$4" max_seqs="$5" gpu_util="$6" timeout_s="$7"
  local started ended startup status note
  echo "=== $slug :: $model ==="

  set_env_kv MODEL_NAME "$model"
  set_env_kv QUANTIZATION "$quant"
  set_env_kv MAX_MODEL_LEN "$max_len"
  set_env_kv MAX_NUM_SEQS "$max_seqs"
  set_env_kv GPU_MEMORY_UTILIZATION "$gpu_util"

  started=$(date +%s)
  docker compose up -d --force-recreate >/dev/null

  if wait_ready_model "$model" "$timeout_s"; then
    ended=$(date +%s)
    startup=$((ended - started))
    status="ready"

    timeout 90s ./run-smoke-test.sh > "benchmark/results/${slug}_smoke.txt" 2>&1 || true
    timeout 900s python3 benchmark/run_benchmark.py \
      --model qwen-local \
      --max-tokens 180 \
      --timeout 240 \
      --out "benchmark/results/${slug}.json" \
      > "benchmark/results/${slug}_benchmark_stdout.txt" 2>&1 || true

    if [ -f "benchmark/results/${slug}.json" ]; then
      note=$(python3 - <<PY
import json
p='benchmark/results/${slug}.json'
d=json.load(open(p))
o=d['overall']
print(f"ok; mean_tps={o['mean_tokens_per_s']}, mean_quality={o['mean_quality']}, mean_latency={o['mean_elapsed_s']}s")
PY
)
    else
      note="ready but benchmark json missing"
    fi
  else
    ended=$(date +%s)
    startup=$((ended - started))
    status="failed"
    docker logs --tail 260 qwen-vllm > "benchmark/results/${slug}_failure.log" 2>&1 || true
    note=$(rg -n "No available memory|out of memory|ValidationError|quantization|failed|RuntimeError|Traceback|Exception|connection reset" "benchmark/results/${slug}_failure.log" | head -n 4 | tr '\n' '; ' || true)
    note=${note:-"not ready within ${timeout_s}s"}
  fi

  printf "%s|%s|%s|%s|%s|%s|%s\n" "$slug" "$model" "$status" "$startup" "$max_len" "$max_seqs" "$note" >> /tmp/qwen35_manual_rows.txt
  echo "DONE: $slug -> $status"
}

: > /tmp/qwen35_manual_rows.txt

run_one "qwen35_0p8b" "Qwen/Qwen3.5-0.8B" "" 4096 8 0.90 420
run_one "qwen35_2b"   "Qwen/Qwen3.5-2B"   "" 4096 8 0.90 420
run_one "qwen35_4b"   "Qwen/Qwen3.5-4B"   "" 4096 4 0.90 480
run_one "qwen35_9b"   "Qwen/Qwen3.5-9B"   "" 2048 1 0.90 600
run_one "qwen35_9b_awq4" "cyankiwi/Qwen3.5-9B-AWQ-4bit" "" 1024 1 0.85 600

{
  echo "| slug | model | status | startup_s | max_len | max_seqs | notes |"
  echo "|---|---|---:|---:|---:|---:|---|"
  cat /tmp/qwen35_manual_rows.txt
} > benchmark/results/qwen35_matrix_summary.md

cat benchmark/results/qwen35_matrix_summary.md
