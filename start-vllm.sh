#!/usr/bin/env bash
set -euo pipefail

extra=()
if [ -n "${QUANTIZATION:-}" ]; then
  extra+=(--quantization "${QUANTIZATION}")
fi

exec vllm serve "${MODEL_NAME}" \
  --host 0.0.0.0 \
  --port 8000 \
  --served-model-name "${SERVED_MODEL_NAME}" \
  --dtype "${DTYPE}" \
  --max-model-len "${MAX_MODEL_LEN}" \
  --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION}" \
  --max-num-seqs "${MAX_NUM_SEQS}" \
  "${extra[@]}"
