# Benchmark — How to Run

Measures TTFT, TG t/s, total time, and LLM-as-judge quality scores across local models.

See [../PLAN.md](../PLAN.md) for context, model shortlist, and project status.

---

## Prerequisites

1. **Ollama running:** `ollama serve` (or via the menu bar app)
2. **Models pulled:** see [../setup/ollama.md](../setup/ollama.md) — run `ollama list` to check
3. **Node 22+:** `node --version`
4. **`gh` CLI authenticated:** `gh auth status` — required for the LLM judge (can skip with `--no-judge`)

For MLX runs, also:
5. **mlx-lm installed:** `pip install --upgrade mlx-lm mlx-vlm`
6. **MLX server running** for the target model (see [../setup/mlx.md](../setup/mlx.md))

---

## Quick Start

```sh
# From the repo root
cd /path/to/llm-benchy

# Run all installed Ollama models, all prompts, 3 runs each
node benchmark/run.mjs

# Or from this directory
node run.mjs
```

> **Note:** Do not run multiple instances of the runner simultaneously against the same Ollama
> endpoint. Ollama queues requests serially per model — parallel runners will produce inflated
> TTFT readings as requests wait in the queue.

Results are written to `results/TIMESTAMP/`:
- `raw/` — one JSON file per model × prompt × run
- `summary.md` — leaderboard table (auto-generated)

---

## Common Invocations

```sh
# Single model — useful for quick iteration after pulling a new model
node run.mjs --model qwen3:30b

# Single prompt — iterate on a specific scenario
node run.mjs --prompt code-write

# Single model + prompt + 1 run — fastest possible smoke test
node run.mjs --model phi4:14b-q4_K_M --prompt instruction-follow --runs 1

# Skip the LLM judge — faster, fully offline
node run.mjs --no-judge

# MLX head-to-head — point at MLX server with a specific model
node run.mjs --engine mlx --endpoint http://localhost:8080/v1 --model mlx-community/gemma-4-26b-a4b-it-4bit

# Filter by engine
node run.mjs --engine ollama
```

---

## What Gets Measured

### Performance metrics (per run)

| Metric | Definition |
|---|---|
| **TTFT** | Time to first token (ms) — from request send to first streamed token |
| **TG t/s** | Token generation throughput — tokens per second *after* the first token |
| **Total time** | Wall clock for the complete response (s) |
| **Output tokens** | Count of streamed tokens in the response |

All three runs are recorded; the **median** is used in the summary table.

TTFT is dominated by prompt processing (PP) speed — how fast the model encodes your input.
TG t/s is dominated by memory bandwidth — proportional to `bandwidth_GB_s / model_size_GB`.

### Quality evaluation

| Prompt type | Method |
|---|---|
| `llm-judge` | `claude-sonnet-4.6` via Copilot API scores accuracy / completeness / conciseness 1–10 |
| `exact-parse` | JSON.parse() check — validates structure, required keys, and value types |
| `exact-match` | String contains the expected answer |

**Composite score** = mean of the three judge dimensions.

---

## Prompt Suite

| ID | Scenario | Category | Eval |
|---|---|---|---|
| `code-explain` | Explain a TypeScript generator function | coding | LLM judge |
| `code-write` | Write a typed CSV parser with error handling | coding | LLM judge |
| `code-debug` | Find and fix an async race condition | coding | LLM judge |
| `repo-summarise` | Summarise this repo (tree + key files, ~2k tokens) | long-context | LLM judge |
| `knowledge-local` | Best practices for local LLMs on Apple Silicon | knowledge | LLM judge |
| `knowledge-trends` | Latest trends in local AI on Apple Silicon (2025/2026) | knowledge | LLM judge |
| `instruction-follow` | Respond ONLY as JSON with exact schema | instruction-following | Exact parse |
| `context-window` | Retrieve a fact from an 8k-token document | long-context | Exact match |

---

## Adding Models

Edit `models.json`. Required fields:

```json
{
  "id": "unique-id",
  "label": "Human-readable name",
  "engine": "ollama",
  "endpoint": "http://localhost:11434/v1",
  "model": "ollama-model-tag",
  "category": "general",
  "num_ctx": 32768,
  "installed": true
}
```

Set `"installed": false` to have the runner skip the model with a helpful message showing the pull command.

---

## Adding Prompts

Edit `prompts.json`. Required fields:

```json
{
  "id": "unique-id",
  "category": "coding",
  "title": "Short description",
  "eval": "llm-judge",
  "judge_criteria": "What the judge should look for when scoring.",
  "system": "System prompt for the model.",
  "user": "The actual user prompt."
}
```

Supported `eval` values: `llm-judge`, `exact-parse`, `exact-match` (requires `expected_answer`).

---

## Interpreting Results

**Speed:** Higher TG t/s = more responsive. For interactive use, aim for >10 t/s. Below ~5 t/s feels slow for long responses.

**TTFT:** Lower is better for latency feel. MoE models (e.g. Gemma 4 26B) tend to have lower TTFT because fewer parameters are activated per token.

**Quality score:** Take judge scores as directional, not absolute. The judge (`claude-sonnet-4.6`) may have its own biases. The `instruction-follow` and `context-window` prompts use objective evaluation (parse/match) and are more reliable signals.

**Trade-off:** Look for models in the top-right of a TG t/s vs quality scatter — fast *and* accurate. The Gemma 4 26B MoE is worth watching here given its active-parameter efficiency.

---

## Results Directory

```
results/
  YYYY-MM-DDTHH-MM/
    raw/
      MODEL-ID__PROMPT-ID__run1.json
      MODEL-ID__PROMPT-ID__run2.json
      ...
    summary.md
```

`results/` is gitignored. Copy `summary.md` files manually into a named directory if you want to preserve them:

```sh
cp results/2026-04-07T.../summary.md results/2026-04-07-initial.md
git add local-llm/benchmark/results/2026-04-07-initial.md
```
