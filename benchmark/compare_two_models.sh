#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

MODEL_A="${MODEL_A:-Qwen/Qwen2.5-3B-Instruct}"
MODEL_B="${MODEL_B:-Qwen/Qwen2.5-1.5B-Instruct}"
SERVED="${SERVED_MODEL_NAME:-qwen-local}"

set_model() {
  local m="$1"
  if rg -q '^MODEL_NAME=' .env; then
    sed -i "s|^MODEL_NAME=.*|MODEL_NAME=${m}|" .env
  else
    echo "MODEL_NAME=${m}" >> .env
  fi
}

wait_ready() {
  for _ in {1..240}; do
    if curl -fsS http://localhost:8000/v1/models 2>/dev/null | rg -q "${SERVED}"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

run_one() {
  local label="$1"
  local m="$2"
  set_model "$m"
  docker compose up -d --force-recreate >/dev/null
  wait_ready
  python3 benchmark/run_benchmark.py --model "${SERVED}" --out "benchmark/results/${label}.json"
}

run_one model_a "$MODEL_A"
run_one model_b "$MODEL_B"

python3 - <<'PY'
import json
from pathlib import Path

base = Path('benchmark/results')
a = json.loads((base / 'model_a.json').read_text())
b = json.loads((base / 'model_b.json').read_text())

def s(x):
    return x['overall']

sa, sb = s(a), s(b)
print('MODEL A:', sa)
print('MODEL B:', sb)
print('DELTA (A-B):')
print({
    'mean_elapsed_s': round(sa['mean_elapsed_s'] - sb['mean_elapsed_s'], 3),
    'mean_tokens_per_s': round(sa['mean_tokens_per_s'] - sb['mean_tokens_per_s'], 2),
    'mean_quality': round(sa['mean_quality'] - sb['mean_quality'], 3),
    'pass_rate_at_0_70': round(sa['pass_rate_at_0_70'] - sb['pass_rate_at_0_70'], 3),
})
PY
