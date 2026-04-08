# Local LLM Exploration — Plan

> Persistent plan and progress tracker. Update the status checklist as work progresses.
> Last updated: 2026-04-07

---

## Status

### Phase 1 — Documentation
- [x] `PLAN.md` — this file
- [x] `README.md` — research summary, hardware context, engine comparison, model table
- [x] `setup/ollama.md` — install, pull models, num_ctx fix, OpenCode config snippet
- [x] `setup/mlx.md` — install mlx-lm, pull MLX models, serve, OpenCode config snippet
- [x] `opencode/ollama-provider.json` — drop-in provider block for Ollama
- [x] `opencode/mlx-provider.json` — drop-in provider block for MLX

### Phase 2 — Benchmark
- [x] `benchmark/prompts.json` — 8-prompt test suite with metadata
- [x] `benchmark/models.json` — model registry (tags, engine, context window, category)
- [x] `benchmark/run.mjs` — Node ESM runner: TTFT, TG t/s, LLM-as-judge via Copilot API
- [x] `benchmark/README.md` — how to run, interpret results, scoring rubric

### Phase 3 — Execution
- [x] Install `mlx-lm` + `mlx-vlm` (Python 3.12 venv at `~/.venvs/mlx`)
- [x] Pull `gemma4:26b` (17 GB — installed)
- [x] Pull `gemma4:31b` (19 GB — installed)
- [x] Pull `qwen2.5-coder:32b-instruct-q4_K_M` (19 GB — installed)
- [x] Run full Ollama benchmark (10 models, 8 prompts, 2 runs each — 154 raw results)
- [x] Run `aggregate.mjs` → `benchmark/summary.md` generated
- [x] Update `opencode.json` with top models as named Ollama providers (gemma4:26b, qwen3:30b, qwen2.5-coder:32b, qwq:32b, phi4:14b, qwen2.5-coder:7b)
- [x] Pull MLX models for head-to-head (`mlx-community/gemma-4-26b-a4b-it-4bit` — downloaded, 14.5 GB)
- [x] Run MLX head-to-head benchmark — **PARTIAL** (see findings below)
  - Speed: MLX 37.7 t/s vs Ollama 27.7 t/s (+36%)
  - TTFT: MLX ~1.4s vs Ollama ~31.8s (Ollama has MoE cold-start penalty)
  - Quality scoring blocked: Gemma 4 via MLX runs with **thinking mode always on** — very long reasoning chains (500–8000 tokens) before content, making judge-scored prompts impractical
  - Not apples-to-apples: `gemma4:26b` Ollama = no thinking; `mlx-community/gemma-4-26b-a4b-it-4bit` = thinking always on
  - Fix options: (a) find a no-thinking MLX variant, (b) use a non-thinking model for head-to-head (e.g. `mlx-community/Qwen3-30B-4bit` with `enable_thinking=False`)
  - Also: mlx-lm 0.31.2 (from GitHub HEAD) required for gemma4 support — 0.31.1 on PyPI throws `Model type gemma4 not supported`
  - Also: `--max-tokens 8000` required on server startup — default is 512, per-request override is ignored

### Phase 4 — Apple Neural Engine (apfel)
- [ ] Verify macOS 26 (Tahoe) is installed — required (`sw_vers`)
- [ ] Install apfel (`brew install Arthur-Ficial/tap/apfel`)
- [ ] Start apfel server and confirm OpenAI endpoint (`apfel --serve`)
- [ ] Add apfel provider block to `opencode.json` (see `opencode/apfel-provider.json`)
- [ ] Run apfel-specific benchmark suite (short-input prompts only — see `benchmark/prompts.json` category: `apfel`)
- [ ] Evaluate quality of small-task responses vs cloud baseline
- [ ] Document findings in `benchmark/results/` — is it good enough for leaf-node tasks?
- [ ] Decide: wire into OpenCode as a standing provider, or leave as opt-in experiment

---

## Context & Goals

Experiment with running capable LLMs locally on an M1 Pro 32 GB MacBook, integrated with
[OpenCode](https://opencode.ai) TUI as a mixture of cloud (GitHub Copilot) and local providers.

**Goals:**
1. Identify the best general-purpose and coding models that fit in ~24 GB usable VRAM
2. Compare inference engines: Ollama (already installed) vs MLX (Apple-native)
3. Measure quality/speed trade-offs across model sizes with a reproducible benchmark
4. Wire the top models into OpenCode as named local providers
5. Document findings so peers can replicate the setup

**Non-goals:**
- vLLM — no Apple Silicon / Metal support (CUDA/ROCm only), ruled out
- llama.cpp directly — Ollama wraps it with better UX; only drop to raw llama.cpp if Ollama proves insufficient
- LM Studio — GUI tool, useful for exploration but not scripted; not benchmarked here

---

## Hardware

| Property | Value |
|---|---|
| Machine | MacBook M1 Pro |
| Unified memory | 32 GB |
| GPU cores | 16 (M1 Pro) |
| Memory bandwidth | ~200 GB/s |
| Usable for models | ~24–28 GB (OS + apps use 4–8 GB) |
| OS | macOS (darwin) |

Memory bandwidth is the primary bottleneck for token generation (TG t/s), not FLOPS.
Rule of thumb: `Q4_K_M TG t/s ≈ bandwidth_GB_s / model_size_GB × scaling_factor`.

---

## Engine Comparison

| Engine | Metal/M1 | Performance | OpenAI API | Notes |
|---|---|---|---|---|
| **Ollama** | Via llama.cpp Metal | Excellent | `localhost:11434/v1` | Best UX; auto-manages models; first-class OpenCode support |
| **MLX / mlx-lm** | Native (Apple's own) | Often fastest | `localhost:8080/v1` | Apple's Metal framework, zero translation overhead; models from `mlx-community` on HF |
| **llama.cpp server** | Native Metal | Excellent | `localhost:8080/v1` | Ollama wraps this; useful for raw control or GGUF models not in Ollama |
| **LM Studio** | Via llama.cpp + MLX | Excellent | `localhost:1234/v1` | GUI + headless mode; not benchmarked here |
| **vLLM** | No Metal support | N/A | N/A | CUDA/ROCm only — not viable on Apple Silicon |
| **apfel** | Neural Engine (via FoundationModels.framework) | Fast (on-device 3B) | `localhost:11434/v1` | Wraps Apple's built-in AFM — zero config, zero cost, zero downloads; requires macOS 26 (Tahoe) |

**Chosen engines:** Ollama (primary) + MLX (head-to-head comparison on 2–3 models) + apfel (small-task / subagent evaluation).

---

## Model Shortlist

### Already installed in Ollama

| Model | Tag | Disk | Category | Notes |
|---|---|---|---|---|
| Qwen3 30B | `qwen3:30b` | 18 GB | General | Sweet spot ceiling for 32 GB |
| Qwen3 14B | `qwen3:14b-q4_K_M` | 9.3 GB | General (fast) | Good mid-tier |
| Phi-4 14B | `phi4:14b-q4_K_M` | 9.1 GB | General (fast) | High quality/GB |
| Gemma 3 27B | `gemma3:27b` | 17 GB | General | Baseline for Gemma 4 comparison |
| QwQ 32B | `qwq:32b` | 19 GB | Reasoning | Thinking/chain-of-thought |
| DeepSeek-R1 32B | `deepseek-r1:32b` | 19 GB | Reasoning | Strong reasoning |
| Qwen2.5-Coder 7B | `qwen2.5-coder:7b` | 4.7 GB | Coding (fast) | Low-latency coding |

### To pull before benchmarking

| Model | Tag | Disk | Category | Why |
|---|---|---|---|---|
| Gemma 4 26B MoE | `gemma4:26b` | 18 GB | General + Coding | New (2025); massive coding leap over Gemma 3; only 3.8B active params → fast |
| Gemma 4 31B | `gemma4:31b` | 20 GB | General + Coding | Dense; near-frontier quality locally; fits in 32 GB with headroom |
| Qwen2.5-Coder 32B | `qwen2.5-coder:32b-instruct-q4_K_M` | ~18 GB | Coding | SOTA open coding model at this size class |

```sh
ollama pull gemma4:26b
ollama pull gemma4:31b
ollama pull qwen2.5-coder:32b-instruct-q4_K_M
```

### Skipped models & rationale

| Model | Reason |
|---|---|
| `llama3.3:70b` | 42 GB — exceeds usable VRAM, will slow-swap, not representative |
| Devstral 24B | Not yet in Ollama library at time of writing; revisit |
| Gemma 4 E2B / E4B | Too small to be interesting for agent use; already have faster small models |
| Any Q8_0 variants of 30B+ | Exceed 32 GB budget |

### MLX head-to-head (2–3 models, matching Ollama tags)

| Model | MLX tag (mlx-community HF) | Notes |
|---|---|---|
| Gemma 4 26B MoE | `mlx-community/gemma-4-26b-a4b-it-4bit` | Ensure `pip install --upgrade mlx-vlm` for PLE fix |
| Qwen3 30B | `mlx-community/Qwen3-30B-4bit` | If available |
| Phi-4 14B | `mlx-community/Phi-4-14B-4bit` | Smallest — good baseline |

### apfel — Apple Foundation Model (Neural Engine)

> Single fixed model, 4096-token context window (hard Apple framework limit). Not suitable for
> multi-step agent use. Benchmarked separately against small, bounded-input tasks only.

| Model | Engine | Context | Notes |
|---|---|---|---|
| `apple-foundationmodel` | apfel (FoundationModels.framework) | 4096 tokens | ~3B params, mixed 2/4-bit; runs on Neural Engine + GPU; zero cost |

**Candidate use cases (fit within 4096 tokens):**
- Grammar / prose correction
- Explain a short function or snippet
- Commit message generation from `git diff --stat`
- Classify/triage (bug vs feature, severity)
- Translate a small code snippet
- Rename / variable naming suggestions
- Strict JSON-only single-turn responses
- Short Q&A / definitions

**Not suitable for:**
- Multi-step agent loops (context fills up immediately)
- Whole-file or whole-repo tasks
- Any task requiring tool calling chains
- Long diffs, stack traces, or document review

**Prerequisites:** macOS 26 (Tahoe) + Apple Intelligence enabled + Apple Silicon.
Check with: `sw_vers` and System Settings → Apple Intelligence & Siri.

---

## Benchmark Design

### Metrics (per model × prompt × 3 runs)

| Metric | How measured |
|---|---|
| **TTFT** | ms from request send → first streamed token chunk |
| **TG t/s** | output_tokens / (total_ms − ttft_ms) × 1000 |
| **Total time** | wall clock ms for complete response |
| **Output tokens** | count from stream |
| **Judge score** | 1–10 per dimension (accuracy, completeness, conciseness) via LLM-as-judge |

### Prompt Suite

| ID | Scenario | Input size | Eval method |
|---|---|---|---|
| `code-explain` | Explain a non-trivial TypeScript function (iterator/generator pattern) | ~40 lines | LLM judge |
| `code-write` | Write a TypeScript CSV parser: typed rows, error handling, edge cases | short | LLM judge |
| `code-debug` | Find and fix an async race condition in a Node.js snippet | ~25 lines | LLM judge |
| `repo-summarise` | Summarise this repo from compact tree + 3 key file excerpts | ~2 k tokens | LLM judge |
| `knowledge-local` | Best practices for running LLMs locally on Apple Silicon | short | LLM judge |
| `knowledge-trends` | Latest trends for local models on Apple Silicon (2025/2026) | short | LLM judge (recency) |
| `instruction-follow` | Respond ONLY as JSON `{answer, confidence, reasoning}` to a factual question | short | Exact JSON parse |
| `context-window` | 8 k-token document; retrieve a specific fact buried in the middle | ~8 k tokens | Exact match |

> **apfel-only prompts** (category: `apfel`) — short-input, single-turn tasks designed to stay well under 4096 tokens:

| ID | Scenario | Input size | Eval method |
|---|---|---|---|
| `apfel-grammar` | Fix grammar and prose in a short paragraph | ~80 words | LLM judge |
| `apfel-commit-msg` | Generate a commit message from a `git diff --stat` summary | ~15 lines | LLM judge |
| `apfel-explain-fn` | Explain a 10-line utility function in plain English | ~10 lines | LLM judge |
| `apfel-json-out` | Return a strict JSON object for a simple factual question | short | Exact JSON parse |
| `apfel-rename` | Suggest 5 better names for a poorly named variable/function | short | LLM judge |

### LLM-as-Judge Design

- **Judge model:** `claude-sonnet-4.6` via GitHub Copilot API (`https://api.githubcopilot.com/chat/completions`)
- **Auth:** `gh auth token` subprocess call at runtime — no hardcoded secrets
- **Rubric (per response):**
  - `accuracy` 1–10 — factually correct, no hallucinations
  - `completeness` 1–10 — addresses all parts of the prompt
  - `conciseness` 1–10 — no unnecessary padding or repetition
  - `rationale` — one sentence explaining the scores
- **Composite score:** mean of the three dimensions
- Judge prompt and response stored alongside raw model output

### CLI Usage

```sh
# All models, all prompts (3 runs each)
node benchmark/run.mjs

# Single model — quick iteration
node benchmark/run.mjs --model qwen3:30b

# Skip judge — faster, offline-friendly
node benchmark/run.mjs --no-judge

# MLX head-to-head (different endpoint)
node benchmark/run.mjs --model gemma4-26b --endpoint http://localhost:8080/v1

# Single prompt
node benchmark/run.mjs --prompt code-write
```

### Output Structure

```
benchmark/results/
  YYYY-MM-DDTHH-MM/
    raw/
      MODEL__PROMPT__RUN.json   # full response + metrics + judge output
    summary.md                  # auto-generated leaderboard table
```

`results/` is gitignored — commit `summary.md` files manually when worth preserving.

---

## OpenCode Integration

### How it works

OpenCode accepts any OpenAI-compatible endpoint via the `@ai-sdk/openai-compatible` provider.
Add provider blocks to `opencode.json` (project-level) or `~/.config/opencode/opencode.json` (global).

### Critical: `num_ctx` for tool calls

Ollama's default context window is **2048 tokens** — far too small for agent tool calls.
OpenCode agents rely heavily on function calling (file read/write/bash); without sufficient context
the calls will silently fail or produce garbled output.

**Fix:** Create an Ollama modelfile override or set `num_ctx` in the request options.
See `setup/ollama.md` for the modelfile approach, which persists across sessions.

Recommended minimum: **32768** tokens.

### Provider config snippets

See `opencode/ollama-provider.json` and `opencode/mlx-provider.json` for ready-to-paste blocks.

### apfel (Apple Foundation Model)

apfel exposes `POST /v1/chat/completions` on `localhost:11434/v1` — the same port as Ollama by default.
If running both, start apfel on a different port: `apfel --serve --port 11435`.

See `opencode/apfel-provider.json` for the ready-to-paste provider block and `setup/apfel.md` for
install instructions.

**Intended role in OpenCode:** not as the primary coding model, but available for quick, offline,
zero-cost single-turn tasks. Select it manually via the model picker when the task is small and
bounded. If macOS ever ships a larger context window for `FoundationModels.framework`, this becomes
more interesting for subagent routing.

---

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-07 | Use Ollama as primary engine | Best UX, first-class OpenCode support, already installed, wraps llama.cpp Metal |
| 2026-04-07 | Add MLX as secondary engine for head-to-head comparison | Apple-native, potentially faster; worth measuring before committing |
| 2026-04-07 | Skip vLLM | No Metal/Apple Silicon support — CUDA only |
| 2026-04-07 | Judge auth via `gh auth token` subprocess | No hardcoded secrets, portable for anyone with `gh` CLI authenticated |
| 2026-04-07 | Judge model: `claude-sonnet-4.6` via Copilot API | Available via existing GitHub Copilot subscription; strong general capability |
| 2026-04-07 | Include Gemma 4 26B MoE + 31B | Gemma 4 is a major step up — LiveCodeBench v6 80% on 31B vs 29% on Gemma 3 27B; Codeforces ELO 2150 vs 110 |
| 2026-04-07 | Skip `llama3.3:70b` in benchmark | 42 GB — exceeds usable VRAM budget; results won't be representative |
| 2026-04-07 | `num_ctx: 32768` as minimum for OpenCode tool use | Ollama default (2048) causes silent tool call failures in agentic workflows |
| 2026-04-07 | Benchmark runner: Node ESM, no external deps | Node 22 available; built-in `fetch` covers HTTP; avoids npm install friction for peers |
| 2026-04-07 | Add apfel (Apple FoundationModels) as Phase 4 | Apple's built-in 3B model runs on Neural Engine — zero cost, zero config, fully offline. 4096-token limit rules out agent use but short single-turn tasks (grammar, commit msgs, JSON out, rename) fit comfortably. Wire into OpenCode via `@ai-sdk/openai-compatible` — same pattern as Ollama/MLX. Benchmark first before committing to standing provider. Requires macOS 26 (Tahoe). |
| 2026-04-07 | apfel default port conflicts with Ollama (both 11434) | Run `apfel --serve --port 11435` when Ollama is also running |
| 2026-04-07 | MLX head-to-head partially blocked by Gemma 4 thinking mode | `mlx-community/gemma-4-26b-a4b-it-4bit` has thinking always on — reasoning consumes 500–8000 tokens before content; Ollama's `gemma4:26b` has thinking off by default. Not comparable. Speed/TTFT still measured: MLX 37.7 t/s (+36%) and ~1.4s TTFT (vs Ollama 31.8s). |
| 2026-04-07 | mlx-lm must be installed from GitHub HEAD for gemma4 | PyPI 0.31.1 throws `Model type gemma4 not supported`. Install with `pip install git+https://github.com/ml-explore/mlx-lm.git` |
| 2026-04-07 | MLX server requires `--max-tokens 8000` on startup | Default is 512; per-request `max_tokens` is ignored if below server default |

## Findings / Pivots — 2026-04-07 additions

- MLX tooling and model compatibility:
  - `mlx-lm` should be installed from GitHub HEAD for the latest model support (Gemma 4 required this). Pin the commit used for reproducibility.
  - Some MLX quantizations (Gemma 4, Qwen3.5 distillations) use an internal thinking mode that streams tokens in `delta.reasoning` before `delta.content`. This affects TTFT and can break judge-based scoring unless you either disable thinking (`enable_thinking:false`) or handle reasoning tokens specially (our runner tracks reasoning_tokens separately and excludes them from judge input).
  - Hugging Face snapshot layout: if model files are present only under `snapshots/<id>/`, symlink or materialise those files into the top-level model dir so `mlx_lm.server` finds `config.json` and tokenizer files.

- Judge considerations:
  - GitHub Copilot (claude-sonnet-4.6) judge calls are rate-limited. For large benchmark sweeps use `--no-judge` and run judge passes later to avoid 429s.
