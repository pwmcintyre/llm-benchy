# Local LLM on Apple Silicon — Research & Setup

Exploration of running capable LLMs locally on an M1 Pro 32 GB MacBook, integrated with
[OpenCode](https://opencode.ai) as a mixture of cloud and local model providers.

See [PLAN.md](./PLAN.md) for the full project plan, status, and decisions log.

---

## Hardware Context

| Property | Value |
|---|---|
| Machine | MacBook M1 Pro |
| Unified memory | 32 GB |
| GPU cores | 16 |
| Memory bandwidth | ~200 GB/s |
| Usable for models | ~24–28 GB (OS + apps consume 4–8 GB) |

**Key insight:** On Apple Silicon, token generation speed (TG t/s) is bounded by memory bandwidth,
not compute. A model that fits entirely in unified memory runs at full Metal throughput. A model that
doesn't fit will page to swap and become unusably slow.

Rule of thumb for Q4_K_M on M1 Pro:
- 7B → ~28–36 t/s
- 14B → ~18–24 t/s
- 30–32B → ~10–15 t/s (sweet spot ceiling for 32 GB)
- 70B → ~2–5 t/s (thrashing swap — not practical)

---

## Inference Engines

### Ollama — recommended primary engine

Wraps llama.cpp with a clean CLI, automatic model management, and an OpenAI-compatible API.

- **API:** `http://localhost:11434/v1`
- **Model management:** `ollama pull <model>`, `ollama list`, `ollama rm <model>`
- **OpenCode support:** first-class via `@ai-sdk/openai-compatible`
- **Performance:** excellent — uses llama.cpp Metal backend natively

**Critical gotcha:** Ollama's default context window is 2048 tokens. For OpenCode agent tool calls
(file read/write/bash), you need at least 32k. See [setup/ollama.md](./setup/ollama.md).

### MLX / mlx-lm — recommended for head-to-head comparison

Apple's own machine learning framework. Models run directly on Metal with no translation layer.

- **API:** `http://localhost:8080/v1` (via `mlx_lm.server`)
- **Models:** `mlx-community` org on HuggingFace (4,500+ pre-quantized models)
- **Performance:** often edges out Ollama on raw t/s for generation; prompt processing is fast
- **Install:** `pip install mlx-lm` — see [setup/mlx.md](./setup/mlx.md)

Important MLX gotchas (documented from experiments)
- mlx-lm: For some models (notably Gemma 4 variants) you must install mlx-lm from GitHub HEAD; PyPI releases (0.31.1) may not support newer model types. Example: `pip install git+https://github.com/ml-explore/mlx-lm.git`.
- Server max-tokens: start the MLX server with a large `--max-tokens` (e.g. 8000). The server default is 512 and can truncate or prevent long chain-of-thought generations even if per-request `max_tokens` is set.
- Thinking mode: several MLX quantizations (Gemma 4, some Qwen distilled variants) emit long "thinking" traces in `delta.reasoning` before `delta.content`. This increases TTFT and can produce very long intermediate streams — disable via `--chat-template-args '{"enable_thinking":false}'` if you want lower latency, or handle `delta.reasoning` specially in your runner (see `benchmark/run.mjs`).
- HF auth & cached snapshots: if you downloaded models with `hf` CLI, Hugging Face stores snapshots under `~/.cache/huggingface/hub/.../snapshots/<id>/`. Some MLX server code expects `config.json` at the model root; if you see FileNotFoundError, materialise snapshot files into the top-level dir (we symlinked snapshot contents into the model dir during testing).

Quick provider validation (curl)
- Start MLX server: `~/.venvs/mlx/bin/mlx_lm.server --model <path-or-hf-repo> --host 127.0.0.1 --port 8080 --max-tokens 8000 --chat-template-args '{"enable_thinking":false}'`
- Test endpoint:

```sh
curl -sS -X POST http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"<repo-or-cache-name>","messages":[{"role":"system","content":"You are a helpful assistant."},{"role":"user","content":"Say hi."}],"stream":false}'
```

If you get a JSON completion (id, choices, usage) the server and model are reachable. If the request hangs or the server returns errors, `tail -f /tmp/mlx-server.log` (or the server log file) while reproducing the request — common failures include BrokenPipeError or ValueError shape mismatches (model/quant incompatibility).

### Not recommended

| Engine | Reason |
|---|---|
| **vLLM** | No Metal/Apple Silicon support — CUDA/ROCm only |
| **LM Studio** | GUI tool, useful for manual exploration but not scriptable |
| **llama.cpp (raw)** | Ollama wraps it with better UX; only drop to raw if you need unsupported GGUF flags |

---

## Model Shortlist

### General-Purpose Models

| Model | Ollama tag | Disk | Est. TG t/s | Context | Notes |
|---|---|---|---|---|---|
| **Qwen3 30B** | `qwen3:30b` | 18 GB | ~12–15 | 32k | Sweet spot ceiling for 32 GB |
| **Gemma 4 31B** | `gemma4:31b` | 20 GB | ~10–13 | 256k | Dense; near-frontier quality; vision capable |
| **Gemma 4 26B MoE** | `gemma4:26b` | 18 GB | ~20–28 | 256k | MoE: only 3.8B active params → faster decode; vision |
| **Gemma 3 27B** | `gemma3:27b` | 17 GB | ~14–18 | 128k | Baseline; compare with Gemma 4 |
| **Qwen3 14B** | `qwen3:14b-q4_K_M` | 9.3 GB | ~18–24 | 32k | Fast mid-tier |
| **Phi-4 14B** | `phi4:14b-q4_K_M` | 9.1 GB | ~22–28 | 16k | High quality/GB ratio |

### Coding Models

| Model | Ollama tag | Disk | Est. TG t/s | Notes |
|---|---|---|---|---|
| **Qwen2.5-Coder 32B** | `qwen2.5-coder:32b-instruct-q4_K_M` | ~18 GB | ~12–15 | SOTA open coding model |
| **Gemma 4 31B** | `gemma4:31b` | 20 GB | ~10–13 | Codeforces ELO 2150 — exceptional for local |
| **Qwen2.5-Coder 7B** | `qwen2.5-coder:7b` | 4.7 GB | ~28–36 | Fast; good for simple tasks |

### Reasoning Models

| Model | Ollama tag | Disk | Est. TG t/s | Notes |
|---|---|---|---|---|
| **QwQ 32B** | `qwq:32b` | 19 GB | ~10–14 | Strong chain-of-thought reasoning |
| **DeepSeek-R1 32B** | `deepseek-r1:32b` | 19 GB | ~10–14 | Thinking model; verbose but thorough |

### Skipped Models

| Model | Reason |
|---|---|
| `llama3.3:70b` | 42 GB — exceeds usable VRAM; swap thrashing makes results unrepresentative |
| Devstral 24B | Not yet in Ollama library at time of writing |
| Gemma 4 E2B / E4B | Edge models; too small for agent use |
| Any Q8_0 of 30B+ | Exceeds 32 GB budget |

---

## Gemma 4 26B MoE — Agentic Use Tips

Community report (April 2026) suggests the following config produces reliable tool calling with no looping:

| Setting | Value | Notes |
|---|---|---|
| **Quant** | Unsloth Q3_K_M | ~14.5 GB; reportedly avoids tool-call loop bug vs default Q4 |
| **Temperature** | `1.0` | Critical — lower values reported to degrade tool use |
| **Top-K** | `40` | |
| **Flash attention** | enabled | `OLLAMA_FLASH_ATTENTION=1` |
| **Context** | up to 260k | On 24 GB VRAM; scales well vs Qwen MoE at high context |

**System prompt pattern that works well for agentic use:**

```
You are a deterministic assistant. LOGIC: Strict sequential execution. One tool at a time.
THINK before acting. If an action fails, diagnose; if it fails twice, STOP and ask.
Never repeat failed calls. When executing tools, the THINK phase must result in exactly
one planned action. Never generate multiple tool calls for a single user request.
```

**Caveats:** results are mixed in the community — some users find Qwen3.5 MoE more reliable
for tool calling out-of-the-box, particularly on Linux. The loop issue may also be a
llama.cpp parser bug patched in recent Ollama versions. Test with your own workload.

*Source: [r/LocalLLaMA — "Gemma 4 26b A3B is mindblowingly good, if configured right"](https://www.reddit.com/r/LocalLLaMA/comments/1segstx/gemma_4_26b_a3b_is_mindblowingly_good_if/) (Apr 2026)*

---

## Gemma 4 — Notable Upgrade

Gemma 4 (released 2025) is a significant step up from Gemma 3, especially for coding:

| Benchmark | Gemma 4 31B | Gemma 4 26B MoE | Gemma 3 27B |
|---|---|---|---|
| LiveCodeBench v6 | **80.0%** | 77.1% | 29.1% |
| Codeforces ELO | **2150** | 1718 | 110 |
| MMLU Pro | 85.2% | 82.6% | 67.6% |
| AIME 2026 | 89.2% | 88.3% | 20.8% |
| GPQA Diamond | 84.3% | 82.3% | 42.4% |

The **26B MoE** variant is particularly interesting: same 18 GB disk footprint as Qwen3 30B,
but only 3.8B active parameters → noticeably faster decode. Use this for interactive work;
use 31B when quality matters more than speed.

All Gemma 4 models include vision input (images). The 26B and 31B have 256k context windows.

> **MLX note:** early 4-bit MLX quantizations of Gemma 4 had a bug in PLE (Per-Layer Embedding)
> layers. Run `pip install --upgrade mlx-vlm` before using any Gemma 4 MLX model.

---

## OpenCode Integration

OpenCode supports local models via any OpenAI-compatible endpoint. See:

- [`opencode/ollama-provider.json`](./opencode/ollama-provider.json) — Ollama provider block
- [`opencode/mlx-provider.json`](./opencode/mlx-provider.json) — MLX provider block
- [`setup/ollama.md`](./setup/ollama.md) — full setup including the `num_ctx` fix
- [`setup/mlx.md`](./setup/mlx.md) — MLX install and server setup

---

## Benchmark

See [`benchmark/README.md`](./benchmark/README.md) for the full benchmark guide.

Quick start (requires Ollama running):

```sh
node local-llm/benchmark/run.mjs
```
