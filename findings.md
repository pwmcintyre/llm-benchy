# Local LLM Findings

**Status:** in progress — benchmark sweep running, no judge pass yet. Numbers below are from the first complete multi-model run (2026-04-07) plus partial results from today's serial sweep (2026-04-08).

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

## Speed Results (Ollama, multi-model run, 2026-04-07)

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
| Short bounded tasks (commit msg, rename, JSON, grammar) | Phi-4 14B or Gemma 4 26B MoE (MLX) | Fast, reliable instruction following, small enough to leave memory for other tools |
| Code explanation / debugging (with context) | Gemma 4 26B MoE (MLX) | Best speed/quality balance at this size; MLX TTFT is sub-second |
| Longer code tasks (bounded scope) | Qwen3 30B (Ollama) | 40 t/s means long outputs complete quickly; needs thinking mode disabled |
| Offline / batch quality tasks | Gemma 4 31B (Ollama) | Highest quality; use when latency doesn't matter |

**Avoid for local interactive use:**
- Reasoning models (QwQ, DeepSeek-R1): too slow, too verbose
- Open-ended knowledge questions: send to cloud
- Qwen3 models without explicit thinking-mode configuration: they will break instruction-following tasks

**For OpenCode wiring:** Gemma 4 26B MoE via MLX is the first candidate to wire in, using an SSE proxy or OpenCode provider config with `enable_thinking: false`. The sub-second TTFT and 35 t/s throughput makes it feel responsive. Phi-4 14B via Ollama is the fallback if MLX isn't available — it's small, fast enough, and reliably follows instructions.

---

## Known Issues

- **Qwen3 thinking mode:** Qwen3 models (14B, 30B) output chain-of-thought by default via Ollama. This inflates token counts and breaks strict JSON prompts. Disable via Ollama `num_thread` or prompt-level system instruction.
- **Gemma 4 Ollama TTFT:** The 256k-context architecture causes a long KV-cache build on first token (20–40s). Subsequent cached requests are faster (see run2 vs run1 TTFTs in the comparison file). MLX avoids this.
- **MLX empty output:** Some early MLX runs produced 0-token responses (score 5.7). Root cause: `--max-tokens` set too low at server startup. Always start with `--max-tokens 8000`.
- **Token truncation:** Models that hit the 2048-token runner default are marked `[TRUNCATED]`. Code-write prompts frequently hit this; use `--max-tokens 4096` for code tasks.
- **Memory contention:** Running MLX and Ollama concurrently exhausts 32 GB unified memory. Serial execution via `run_serial.mjs` is mandatory.

---

## Next Steps

1. Let the current serial sweep complete (QwQ 32B in progress).
2. Run a judge pass on all `--no-judge` results using `judge_saved.mjs` once `OPENAI_API_KEY` is available.
3. Wire Gemma 4 26B MoE (MLX) into OpenCode as a provider and run an interactive validation test.
4. Test Qwen3 30B with thinking disabled to see if quality scores recover.
5. Decide on SSE proxy vs OpenCode code change for surfacing reasoning tokens if thinking mode is needed.
