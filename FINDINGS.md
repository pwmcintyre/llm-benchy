# Findings Log

## Summary

| Model | Runtime | Status | Key notes |
|---|---|---|---|
| `Qwen/Qwen2.5-1.5B-Instruct` | vLLM + Docker | Works | Fastest tested; lower task quality vs 3B. |
| `Qwen/Qwen2.5-3B-Instruct` | vLLM + Docker | Works (current default) | Best stable tradeoff tested so far. |
| `Qwen/Qwen3.5-0.8B` | vLLM + Docker | Works | Mean speed ~168 tok/s; lowest quality of tested 3.5 sizes. |
| `Qwen/Qwen3.5-2B` | vLLM + Docker | Works | Best quality among tested Qwen3.5 sizes here; mean speed ~84 tok/s. |
| `Qwen/Qwen3.5-4B` | vLLM + Docker | Works | Mean speed ~41 tok/s; quality below 2B in this benchmark. |
| `Qwen/Qwen3.5-9B` | vLLM + Docker | Fails on 12GB 4070 | Not ready within 600s; model load observed at 17.66 GiB. |
| `cyankiwi/Qwen3.5-9B-AWQ-4bit` | vLLM + Docker | Fails on 12GB 4070 | Repeated `No available memory for the cache blocks` during init. |

### Quick recommendation
- Daily local agent workloads on this hardware: use `Qwen/Qwen2.5-3B-Instruct` or `Qwen/Qwen3.5-2B`.
- For 9B class on this hardware: prefer testing GGUF + `llama.cpp` CUDA rather than vLLM.

## Latest Qwen 3.5 Matrix (Up To 9B)

| slug | model | status | startup_s | max_len | max_seqs | notes |
|---|---|---:|---:|---:|---:|---|
| `qwen35_0p8b` | `Qwen/Qwen3.5-0.8B` | ready | 106 | 4096 | 8 | mean_tps=168.15, mean_quality=0.146, mean_latency=4.198s |
| `qwen35_2b` | `Qwen/Qwen3.5-2B` | ready | 112 | 4096 | 8 | mean_tps=83.78, mean_quality=0.271, mean_latency=5.086s |
| `qwen35_4b` | `Qwen/Qwen3.5-4B` | ready | 126 | 4096 | 4 | mean_tps=40.65, mean_quality=0.181, mean_latency=7.17s |
| `qwen35_9b` | `Qwen/Qwen3.5-9B` | failed | 600 | 2048 | 1 | not ready within 600s; model load observed at 17.66 GiB |
| `qwen35_9b_awq4` | `cyankiwi/Qwen3.5-9B-AWQ-4bit` | failed | 600 | 1024 | 1 | `No available memory for the cache blocks` |

The generated summary file is also available at `benchmark/SUMMARY_QWEN35.md`.

## Alternatives Research Status

- Candidate alternatives identified for this hardware profile:
  - `Qwen/Qwen2.5-Coder-3B-Instruct`
  - `deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B`
  - `google/gemma-3-4b-it`
  - `deepseek-ai/DeepSeek-R1-Distill-Qwen-7B`

### Alternatives Validation Results

| slug | model | status | startup_s | max_len | max_seqs | notes |
|---|---|---:|---:|---:|---:|---|
| `alt_qwen25_coder_3b` | `Qwen/Qwen2.5-Coder-3B-Instruct` | ready | 70 | 4096 | 8 | mean_tps=62.53, mean_quality=0.306, mean_latency=2.878s |
| `alt_deepseek_r1_qwen_1p5b` | `deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B` | ready | 112 | 4096 | 8 | mean_tps=117.14, mean_quality=0.083, mean_latency=1.537s |
| `alt_gemma3_4b` | `google/gemma-3-4b-it` | failed | 480 | 4096 | 4 | Gated model (HF 401). Requires approved account access + auth token. |
| `alt_deepseek_r1_qwen_7b` | `deepseek-ai/DeepSeek-R1-Distill-Qwen-7B` | failed | 559 | 2048 | 1 | `No available memory for the cache blocks` on 12GB 4070 in this stack. |

### Alternatives Takeaways
- Best quality among tested alternatives in this benchmark: `Qwen/Qwen2.5-Coder-3B-Instruct` (`mean_quality=0.306`).
- Fastest working alternative: `DeepSeek-R1-Distill-Qwen-1.5B`, but quality dropped sharply on practical troubleshooting prompts.
- `Gemma 3 4B` could not be evaluated due to repository gating.
- `DeepSeek-R1-Distill-Qwen-7B` is not viable on this setup under vLLM due to memory headroom/KV cache limits.

Full alternatives run output is stored at `benchmark/results/alternatives_summary.md`.

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
