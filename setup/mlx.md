# MLX Setup

Setup guide for running local LLMs via Apple's MLX framework on Apple Silicon (M1 Pro 32 GB),
with OpenCode integration. Use this alongside [ollama.md](./ollama.md) for the head-to-head comparison.

MLX is Apple's own machine learning framework. It runs directly on Metal with no translation layer,
which often gives it an edge over Ollama (llama.cpp Metal) for raw generation speed.

---

## Install

Requires Python 3.11–3.12 and macOS 14+ (Sonoma) on Apple Silicon.

> **Python version note:** Use Python 3.12, not 3.14. Homebrew's default `python3` may be 3.14
> which doesn't yet have stable wheels for all ML dependencies. Use `python3.12` explicitly.

```sh
# Create a dedicated venv (prevents breaking Homebrew's Python)
/opt/homebrew/bin/python3.12 -m venv ~/.venvs/mlx
source ~/.venvs/mlx/bin/activate

# Install mlx-lm from GitHub HEAD — PyPI 0.31.1 lacks gemma4 support
# (install --upgrade mlx-vlm for the Gemma 4 PLE quantization fix)
pip install git+https://github.com/ml-explore/mlx-lm.git
pip install --upgrade mlx-vlm

# Verify
python3 -c "import mlx_lm; print('mlx_lm OK'); import mlx_vlm; print('mlx_vlm OK')"
```

> **PyPI version warning:** `pip install mlx-lm` installs 0.31.1 which throws
> `Model type gemma4 not supported`. Install from GitHub HEAD to get the fix.

The venv is at `~/.venvs/mlx`. Activate it before any `mlx_lm` commands:

```sh
source ~/.venvs/mlx/bin/activate
```

---

## Pull Models

MLX models come from the [`mlx-community`](https://huggingface.co/mlx-community) org on HuggingFace.
They use HuggingFace's `safetensors` format with MLX-specific quantization (4bit, 6bit, 8bit, bf16).

### Models for head-to-head comparison with Ollama

Download these to match the Ollama benchmark set:

```sh
# Gemma 4 26B MoE — 4-bit (matches ollama gemma4:26b)
python3 -m mlx_lm.convert --hf-path mlx-community/gemma-4-26b-a4b-it-4bit \
  --mlx-path ~/.mlx-models/gemma-4-26b-a4b-it-4bit

# OR use mlx_lm.generate to auto-download on first use:
python3 -m mlx_lm.generate \
  --model mlx-community/gemma-4-26b-a4b-it-4bit \
  --prompt "Hello" \
  --max-tokens 10
# (this caches the model in ~/.cache/huggingface/)
```

Recommended models to pull:

| Model | HF path | Approx size |
|---|---|---|
| Gemma 4 26B MoE | `mlx-community/gemma-4-26b-a4b-it-4bit` | ~18 GB |
| Qwen3 30B | `mlx-community/Qwen3-30B-4bit` | ~18 GB |
| Phi-4 14B | `mlx-community/Phi-4-14B-4bit` | ~9 GB |

> Models are cached in `~/.cache/huggingface/hub/`. Check available space first:
> ```sh
> df -h ~
> ```

---

## Run the Server (OpenAI-compatible API)

```sh
# Start the MLX server on port 8080
# IMPORTANT: set --max-tokens high — default is 512 and per-request override is ignored
python3 -m mlx_lm server \
  --model mlx-community/gemma-4-26b-a4b-it-4bit \
  --port 8080 \
  --host 127.0.0.1 \
  --max-tokens 8000
```

> **Note:** The server default of `--max-tokens 512` is a hard cap that cannot be overridden
> per-request. Always set `--max-tokens` at server startup to a value that fits your use case.
> For OpenCode agent use, 8000 is a reasonable floor; Gemma 4's thinking trace alone can consume
> 500–2000 tokens before the actual answer.

The server exposes an OpenAI-compatible endpoint at `http://localhost:8080/v1`.

### Verify

```sh
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mlx-community/gemma-4-26b-a4b-it-4bit",
    "messages": [{"role": "user", "content": "Say hello in one word."}],
    "max_tokens": 10
  }' | python3 -m json.tool
```

---

## OpenCode Provider Config

See [`../opencode/mlx-provider.json`](../opencode/mlx-provider.json) for the full snippet.

Minimal example — note the endpoint is `localhost:8080` not `11434`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "mlx": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "MLX (local)",
      "options": {
        "baseURL": "http://localhost:8080/v1"
      },
      "models": {
        "mlx-community/gemma-4-26b-a4b-it-4bit": {
          "name": "Gemma 4 26B MoE (MLX)",
          "limit": { "context": 32768, "output": 8192 }
        }
      }
    }
  }
}
```

> The model ID sent to the API must match exactly what `mlx_lm.server` expects —
> use the full HuggingFace path (`mlx-community/model-name`).

---

## MLX vs Ollama — What to Expect

| Aspect | MLX | Ollama |
|---|---|---|
| Token generation (TG) | Often 10–30% faster | Excellent |
| Prompt processing (PP) | Comparable or faster | Excellent |
| Model switching | Manual (restart server) | Automatic |
| Model library | HuggingFace `mlx-community` | `ollama.com/library` |
| Quantization format | 4bit/6bit/8bit/bf16 (MLX) | GGUF (Q4_K_M, Q8_0, etc.) |
| Vision models | Yes (via mlx-vlm) | Varies by model |
| Ease of use | Moderate (Python CLI) | Very easy |
| OpenCode integration | Via `@ai-sdk/openai-compatible` | Via `@ai-sdk/openai-compatible` |

---

## Gemma 4 on MLX — Thinking Mode

Gemma 4 via MLX runs with **thinking mode always on by default**. Before generating the visible
answer, the model produces a chain-of-thought reasoning trace in `delta.reasoning` (not
`delta.content`). On complex prompts, this trace can consume 500–8000 tokens and take 30–200
seconds before a single content token appears.

**Practical implications:**
- For interactive use, Gemma 4 via MLX is only suitable for short/simple tasks where the
  reasoning trace stays under ~500 tokens
- For benchmarking, set `--max-tokens` very high (≥8000) on the server — but expect long waits
- For head-to-head comparison with Ollama's `gemma4:26b` (non-thinking), the results are not
  directly comparable — they're different inference modes
- The `thinking: false` request parameter is not respected by `mlx_lm.server`

**Alternative:** Use `mlx-community/Qwen3-30B-4bit` for head-to-head comparisons — Qwen3 supports
`enable_thinking=False` (pass as request option) which disables the thinking trace.
