# Local LLM Findings

**Status:** in progress — Ollama sweep complete (2026-04-07), MLX sweep complete (2026-04-08). No judge pass yet; focusing on speed metrics for model selection.

**Hardware:** MacBook M1 Pro, 32 GB unified memory, macOS 15.

---

## Goal

Determine where local models are viable in a hybrid development workflow: cloud-hosted frontier models (e.g. Claude) handle high-level planning and complex reasoning; local models handle bounded, repetitive sub-tasks that follow from that plan — commit messages, renaming, code explanation, JSON output, short diffs.

The benchmark is the first step: understand what this hardware can actually do before wiring anything into OpenCode.

---

## Benchmark Setup

- **Runner:** `local-llm/benchmark/run.mjs` — OpenAI-compatible streaming, records TTFT, TG t/s, total time, output tokens.
- **Prompts:** 13 tasks across five categories — `coding`, `long-context`, `knowledge`, `instruction-following`, and `apfel` (short bounded tasks matching likely local-model use cases).
- **Engines:** Ollama and MLX (Apple-native). Both expose an OpenAI-compatible API.
- **Execution:** serial via `run_serial.mjs` to prevent memory contention between models.
- **Judging:** first pass used Claude Sonnet 4.6 as judge. Scores are 0–10. A second pass with GPT-4o-mini is planned once the sweep completes.

---

## Models Tested

| Model | Engine | Size on disk | Notes |
|---|---|---|---|
| Qwen3 30B | Ollama | 18 GB | Q4_K_M |
| Gemma 4 26B MoE | Ollama | 18 GB | sparse MoE, 3.8B active params |
| Gemma 4 31B | Ollama | 20 GB | dense, near-frontier quality |
| Gemma 3 27B | Ollama | 17 GB | previous-gen baseline |
| Qwen2.5-Coder 32B | Ollama | 18 GB | coding specialist |
| Phi-4 14B | Ollama | 9.1 GB | small, fast |
| Qwen3 14B | Ollama | 9.3 GB | small, fast |
| QwQ 32B | Ollama | 19 GB | reasoning/thinking model |
| DeepSeek-R1 32B | Ollama | 19 GB | reasoning/thinking model |
| Qwen2.5-Coder 7B | Ollama | 4.7 GB | smallest coding model |
| Gemma 4 26B MoE | MLX | 18 GB | same weights, Apple-native runtime |

---

## Speed Results (Ollama, 2026-04-07)

Sorted by median TG t/s. TTFT is median across all 13 prompts.

| Model | Median TG t/s | Median TTFT (ms) | Avg quality score |
|---|---|---|---|
| **Qwen3 30B** | **40.8** | 1,176 | 5.6 |
| Gemma 4 26B MoE | 27.7 | 31,774 | 8.0 |
| Qwen2.5-Coder 7B | 26.0 | 951 | 6.5 |
| Phi-4 14B | 13.2 | 1,798 | 6.8 |
| Qwen3 14B | 12.7 | 1,785 | 5.8 |
| Gemma 3 27B | 6.7 | 4,025 | 7.8 |
| Qwen2.5-Coder 32B | 6.0 | 3,976 | 6.8 |
| QwQ 32B | 5.8 | 4,050 | 6.3 |
| DeepSeek-R1 32B | 5.8 | 4,157 | 5.4 |
| Gemma 4 31B | 4.9 | 84,822 | 9.3 |

**Qwen3 30B stands out:** 40.8 t/s is roughly 7× faster than anything of comparable weight class (Qwen2.5-Coder 32B, Gemma 3 27B, the reasoning models). This is because Qwen3 30B is a dense model that happens to fit comfortably in 32 GB, and the Q4_K_M quantisation runs efficiently on the M1 Pro's unified memory bandwidth.

**MLX advantage:** Gemma 4 26B in MLX averages ~35.7 t/s vs ~27.7 t/s under Ollama — a ~29% improvement using the same quantised weights. TTFT also drops dramatically (sub-1 second vs 30+ seconds under Ollama). MLX is the right engine for this hardware for models that have MLX-community snapshots available.

---

## Quality Results (2026-04-07, judge: Claude Sonnet 4.6)

| Model | Avg score | Prompts judged | Notable strengths |
|---|---|---|---|
| **Gemma 4 31B** | **9.3** | 5 | Best overall quality; code explain/debug |
| Gemma 4 26B MoE | 8.0 | 8 | Strong coding + context retrieval; fast for MoE |
| Gemma 3 27B | 7.8 | 7 | Consistent; previous-gen but solid |
| Qwen2.5-Coder 32B | 6.8 | 8 | Good code; poor knowledge |
| Phi-4 14B | 6.8 | 8 | Good quality/GB ratio; reliable instruction-following |
| Qwen2.5-Coder 7B | 6.5 | 8 | Fastest small model; adequate for bounded tasks |
| QwQ 32B | 6.3 | 6 | Thinking overhead; not suitable interactively |
| Qwen3 14B | 5.8 | 7 | Fails instruction-follow (thinking mode leaks) |
| Qwen3 30B | 5.6 | 7 | Fast but low quality scores; thinking mode issues |
| DeepSeek-R1 32B | 5.4 | 7 | Slow + low quality; not competitive here |

**Gemma 4 31B** has the highest quality but at 4.9 t/s and 85-second TTFTs it is not interactive. A code explanation prompt takes 3 minutes. This is a batch or asynchronous tool, not an interactive one.

**Gemma 4 26B MoE** is the most interesting model: it scores 8.0 quality, generates at 27.7 t/s (Ollama) / 35.7 t/s (MLX), and its sparse MoE architecture means only 3.8B parameters are active per token. However its Ollama TTFT is ~30 seconds — due to KV-cache construction across its 256k-context architecture. MLX largely fixes this (sub-1s TTFT).

---

## Task-by-Task Analysis

### Context window retrieval
Every model scored 10/10 on the buried-fact retrieval task. Local models are fully capable of reading a document you hand them and finding a specific piece of information. This is the clearest green light for local use.

### Code explanation and debugging
High scores across the board (7–9.3). Even small models (Qwen2.5-Coder 7B: 8.3 on code-debug) do well here because the prompt contains all necessary context. This is a strong local-model use case.

### Code generation (open-ended)
More variable (4.3–6.0 range for code-write). Smaller models get truncated at 2048 tokens and produce incomplete implementations. Models with higher TG t/s (Qwen3 30B, Gemma 4 26B MoE) can produce more complete output within a reasonable time budget.

### Short bounded tasks (commit messages, rename, JSON, grammar)
The `apfel` prompt category reflects the intended local use case. Results are not yet fully judged (the new serial run did not use a judge), but qualitatively these tasks completed in 3–28 seconds for the 14-30B models. This is workable.

### Instruction following (strict JSON output)
A notable split: Gemma 4 26B MoE, Phi-4 14B, Qwen2.5 models, Gemma 3/4 all score 10/10. **Qwen3 30B, Qwen3 14B, QwQ 32B, and DeepSeek-R1 all score 0/10.** The Qwen3 and QwQ models emit chain-of-thought in their output by default in Ollama, which breaks strict JSON tasks. This is not a fundamental model limitation — it requires disabling thinking mode at the server or system-prompt level — but it is a deployment concern.

### Knowledge questions (open-ended, no context)
All models score poorly (2.8–6.5). This is expected: local models have stale training data and this task penalises hallucination. Open-ended knowledge queries should go to cloud models.

### Reasoning models (QwQ 32B, DeepSeek-R1 32B)
At 5.8 t/s with 4–25 second TTFTs and a tendency to generate thousands of thinking tokens, these are not viable for interactive use. The QwQ 32B `code-write` run has been running for over 23 minutes at time of writing, producing ~3 tokens/second after the initial burst. Reasoning models belong in offline pipelines, not interactive agents.

---

## Engine Comparison: Ollama vs MLX (Gemma 4 26B)

Direct head-to-head on `repo-summarise`:

| Engine | TTFT (ms) | TG t/s | Quality (heuristic) |
|---|---|---|---|
| Ollama | ~30,000–40,000 | 27.3 | 8.7 |
| MLX | 800–880 | 35.5–35.8 | 8.7 |

MLX wins on both TTFT and throughput with equivalent output quality. The TTFT difference (40s vs 0.8s) is dramatic and is the key differentiator for interactive use.

MLX caveats:
- Requires Python venv (`~/.venvs/mlx`) and `mlx_lm.server` with `--max-tokens ≥ 8000`.
- Some snapshots emit reasoning tokens in `delta.reasoning` by default; these must be handled separately or disabled with `chat-template-args {"enable_thinking":false}`.
- Model snapshot availability varies; not every Ollama model has an MLX-community equivalent.
- MLX results that emit 0 content tokens (score 5.7 in the repo-summarise comparison) indicate a server configuration issue, not a model capability failure.

---

## Recommendation (preliminary, pre-judge-pass)

**For interactive local use in a hybrid workflow:**

| Use case | Recommended model | Why |
|---|---|---|
| **Short bounded tasks** (commit msg, rename, JSON, grammar) | **Gemma 4 26B MoE (MLX)** | 40+ t/s, 1.2s TTFT; interactive feel. Best balance of speed and responsiveness. |
| **Code explanation / debugging** | **Gemma 4 26B MoE (MLX)** | Sub-1.3s TTFT, 39–40 t/s on all code tasks. Instant response to context queries. |
| **Longer code generation** | Qwen3 30B (Ollama) | 40.8 t/s for extended output. MLX equivalent not benchmarked; Gemma 4 26B (MLX) also viable but untested at >2048 tokens. |
| **Offline / batch quality** | Gemma 4 31B (Ollama) | 9.3/10 score; use when latency immaterial (hourly sweeps, background jobs). |

**Avoid for local interactive use:**
- Reasoning models (QwQ, DeepSeek-R1): 5.8 t/s, 4–25s TTFT; not interactive
- Qwen3.5 / Qwen3 distilled variants via MLX: thinking-mode default (1 t/s, 34+ minute code tasks) — not salvageable even with `enable_thinking: false`
- Open-ended knowledge questions: send to cloud (all local models <6/10 quality)
- Qwen3 Ollama without thinking disabled: breaks JSON instruction-following

**For OpenCode wiring:** **Wire Gemma 4 26B MoE (MLX) as the primary local model.** It delivers 40 t/s with sub-1.3s TTFT, making interactive use feel instantaneous. Set it as the default for bounded tasks (commits, edits, explanations). Keep Phi-4 14B (Ollama, 13 t/s) as fallback if MLX server is unavailable.

---

## MLX Results (2026-04-08)

Ran three MLX models with `--engine mlx` filter and `enable_thinking: false` to avoid reasoning-mode slowdown.

| Model | Median TG t/s | Median TTFT (ms) | Notes |
|---|---|---|---|
| **Gemma 4 26B MoE (MLX)** | **40.2** | **1,262** | Exceptional speed; rivals Qwen3 30B Ollama (40.8 t/s). TTFT 25× faster than Ollama (1,262ms vs 31,774ms). **Recommended for wire-up.** |
| Qwen3 Coder 30B (MLX) | 8.9 | 6,362 | Slow startup and sustained throughput. Viable but not compelling vs Ollama Qwen3 30B (40.8 t/s). |
| Qwen3.5 27B (MLX) — killed | 5.2–1.0 t/s | 5,897–13,755ms | **Thinking mode default:** emits 200–300+ reasoning tokens, throttles to <1 t/s on code tasks (34+ minute code-write run). Not viable interactively even with `enable_thinking: false` flag. Skipped. |

**Key finding:** Gemma 4 26B MoE performs nearly identically on MLX vs Ollama in raw t/s (40.2 vs 27.7 **when Ollama runs without thinking mode**), but MLX's TTFT is vastly superior due to the MoE's efficient prompt processing on native Metal hardware.

---

## Known Issues

- **Qwen3 thinking mode:** Qwen3 models (14B, 30B) output chain-of-thought by default via Ollama. This inflates token counts and breaks strict JSON prompts. Disable via Ollama `num_thread` or prompt-level system instruction.
- **Gemma 4 Ollama TTFT:** The 256k-context architecture causes a long KV-cache build on first token (20–40s). Subsequent cached requests are faster (see run2 vs run1 TTFTs in the comparison file). MLX avoids this.
- **MLX empty output:** Some early MLX runs produced 0-token responses (score 5.7). Root cause: `--max-tokens` set too low at server startup. Always start with `--max-tokens 8000`.
- **Token truncation:** Models that hit the 2048-token runner default are marked `[TRUNCATED]`. Code-write prompts frequently hit this; use `--max-tokens 4096` for code tasks.
- **Memory contention:** Running MLX and Ollama concurrently exhausts 32 GB unified memory. Serial execution via `run_serial.mjs` is mandatory.

---

## Next Steps

1. ✅ Ollama sweep complete (2026-04-07) — 10 models, 13 prompts
2. ✅ MLX sweep complete (2026-04-08) — 3 models; Qwen3.5 killed due to thinking-mode issue
3. **Wire Gemma 4 26B MoE (MLX) into OpenCode** — add to provider block, set as default for bounded tasks
4. Interactive validation: test Gemma 4 26B MLX in OpenCode on a real codebase task (e.g. "explain this function", "suggest commit message")
5. Optional: run offline judge pass on April 7 / April 8 results using `judge_saved.mjs` if quality ranking is needed
6. Optional: test larger MLX models (Qwen3 30B, Phi-4 14B) if Gemma 4 26B bottlenecks on extended output (>2048 tokens)
