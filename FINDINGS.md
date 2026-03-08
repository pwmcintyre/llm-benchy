# Findings Log

## Summary

| Model | Runtime | Status | Key notes |
|---|---|---|---|
| `Qwen/Qwen2.5-1.5B-Instruct` | vLLM + Docker | Works | Fastest tested; lower task quality vs 3B. |
| `Qwen/Qwen2.5-3B-Instruct` | vLLM + Docker | Works (current default) | Best stable tradeoff tested so far. |
| `Qwen/Qwen3.5-4B` | vLLM + Docker | Partially validated | Loads, but longer warmup/startup on this stack. |
| `cyankiwi/Qwen3.5-9B-AWQ-4bit` | vLLM + Docker | Fails on 12GB 4070 | Quantization arg mismatch fixed, then KV-cache memory headroom failure after load/compile. |

### Quick recommendation
- Daily local agent workloads: use `Qwen/Qwen2.5-3B-Instruct` (or test `Qwen3.5-4B` if you can tolerate longer startup).
- For 9B class on this hardware: prefer testing GGUF + `llama.cpp` CUDA rather than vLLM.

## 2026-03-08 - Local Qwen setup on WSL2 + RTX 4070 12GB

### Environment
- Windows 11 + WSL2 Ubuntu 24.04
- GPU: NVIDIA RTX 4070 12GB
- Runtime: Docker Desktop + vLLM (`vllm/vllm-openai:latest`)

### Progress
- Docker engine and GPU passthrough validated in container (`nvidia-smi`).
- vLLM service deployed with OpenAI-compatible endpoint at `http://localhost:8000/v1`.
- Working baseline models:
  - `Qwen/Qwen2.5-3B-Instruct`
  - `Qwen/Qwen2.5-1.5B-Instruct`

### Benchmark harness added
- `benchmark/tasks.json` for troubleshooting/setup tasks.
- `benchmark/run_benchmark.py` for speed + rubric scoring.
- `benchmark/compare_two_models.sh` for side-by-side local runs.

### 2.5 benchmark summary
- 3B: slower, slightly better quality than 1.5B.
- 1.5B: faster, slightly lower quality.
- Both underperform on detailed environment-specific troubleshooting vs stronger remote coding models.

### Qwen 3.5 testing status
- `Qwen/Qwen3.5-4B` loads but startup/warmup is longer than 2.5 series.
- `cyankiwi/Qwen3.5-9B-AWQ-4bit` with `QUANTIZATION=awq` failed due to quantization mismatch:
  - model config quantization: `compressed-tensors`
  - runtime arg quantization: `awq`
- Interpretation: this failure is configuration incompatibility, not immediate evidence of insufficient VRAM.

### Next actions
1. Retry 9B model with `QUANTIZATION` unset (let vLLM infer from model config).
2. If still unstable, try another 9B checkpoint (AWQ/GPTQ variant).
3. Record tokens/s, latency, and task-quality deltas vs 2.5-3B baseline.

## 2026-03-08 - 9B fit tuning
- Retried 9B AWQ with quantization auto-detect (`QUANTIZATION=`).
- New failure: not OOM during generation, but startup admission check failed because requested GPU utilization exceeded free VRAM (`10.81/11.99 GiB free` vs target `11.03 GiB`).
- Next attempt: reduce `GPU_MEMORY_UTILIZATION` and `MAX_MODEL_LEN`.

## 2026-03-08 - 9B AWQ viability result on RTX 4070 12GB

### Model tested
- `cyankiwi/Qwen3.5-9B-AWQ-4bit`

### Config attempts
1. `MAX_MODEL_LEN=2048`, `MAX_NUM_SEQS=2`, `GPU_MEMORY_UTILIZATION=0.92`, `QUANTIZATION=awq`
   - Failed: quantization mismatch (`model=compressed-tensors`, arg=`awq`).
2. Same but `QUANTIZATION=` (auto-detect)
   - Failed: startup free-memory target check (insufficient free VRAM for requested utilization).
3. `MAX_MODEL_LEN=1024`, `MAX_NUM_SEQS=1`, `GPU_MEMORY_UTILIZATION=0.85`, `QUANTIZATION=`
   - Model weights loaded (8.43 GiB) and compiled, but engine failed with:
     - `No available memory for the cache blocks`.

### Conclusion
- On this exact stack (WSL2 + vLLM + RTX 4070 12GB + desktop GPU memory usage), this Qwen3.5 9B AWQ checkpoint is not practically deployable as a stable server.
- The blocker is KV cache headroom after model load/compile, not merely download/init speed.

### Practical recommendation
- For always-on local serving on this machine, stay at `Qwen3.5-4B` or `Qwen2.5-3B` in vLLM.
- If 9B is required, test GGUF with `llama.cpp` CUDA (often lower memory footprint than vLLM for single-user inference).
