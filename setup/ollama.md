# Ollama Setup

Setup guide for running local LLMs via Ollama on Apple Silicon (M1 Pro 32 GB),
with OpenCode integration.

---

## Install

```sh
# Homebrew (recommended)
brew install ollama

# Or download from https://ollama.com/download
```

Verify:

```sh
ollama --version
# ollama version is 0.x.y

ollama serve   # starts the server if not already running as a service
```

On macOS, Ollama installs a menu bar app that auto-starts the server. If you prefer CLI only:

```sh
# Start manually
ollama serve

# Or via launchctl (installed by the .pkg installer)
# It runs at localhost:11434 by default
```

---

## Pull Models

Models are stored in `~/.ollama/models`. Pull only what you plan to benchmark — 32 GB fills up fast.

### Check what's already installed

```sh
ollama list   # shows what's present
```

### Pull before benchmarking

```sh
# Gemma 4 — significant upgrade over Gemma 3 for coding
ollama pull gemma4:26b          # 18 GB — MoE, 3.8B active params, fast decode
ollama pull gemma4:31b          # 20 GB — dense, near-frontier quality

# Qwen2.5-Coder — SOTA open coding model
ollama pull qwen2.5-coder:32b-instruct-q4_K_M   # ~18 GB
```

> **Tip:** Only one large model fits in active VRAM at a time. Ollama will swap them
> automatically when you switch, but there's a ~10–30s cold-start cost per model switch.

---

## Fix: `num_ctx` for OpenCode Tool Calls

**This is the most important config change.** Ollama's default context window is **2048 tokens**.
OpenCode's agent tool calls (file read/write/bash/grep) require far more context to function reliably.
With the default, tool calls silently fail or produce garbled output.

### Option A — Modelfile override (persistent, recommended)

Create a custom modelfile that inherits the base model and overrides `num_ctx`:

```sh
# Example for qwen3:30b
cat > /tmp/Modelfile-qwen3-30b << 'EOF'
FROM qwen3:30b
PARAMETER num_ctx 32768
EOF

ollama create qwen3-30b-ctx32k -f /tmp/Modelfile-qwen3-30b
```

Then reference `qwen3-30b-ctx32k` in your OpenCode config instead of `qwen3:30b`.

Repeat for each model you want to use with OpenCode.

### Option B — Per-request options

Pass `num_ctx` in the request body. The benchmark runner does this automatically.
For OpenCode, use the `options` field in your provider config (see below).

---

## OpenCode Provider Config

Add one or more of these provider blocks to your `opencode.json`
(project-level or `~/.config/opencode/opencode.json`).

See [`../opencode/ollama-provider.json`](../opencode/ollama-provider.json) for the full snippet.

Minimal example:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama (local)",
      "options": {
        "baseURL": "http://localhost:11434/v1"
      },
      "models": {
        "qwen3:30b": {
          "name": "Qwen3 30B",
          "limit": { "context": 32768, "output": 8192 }
        },
        "gemma4:26b": {
          "name": "Gemma 4 26B MoE",
          "limit": { "context": 32768, "output": 8192 }
        }
      }
    }
  }
}
```

> The `limit.context` value here tells OpenCode how large the context window is.
> It does **not** automatically set Ollama's `num_ctx` — you still need the modelfile override
> above, or use models you've created with `num_ctx` baked in.

### Switching models in OpenCode

```sh
# Set default model for a session
# In opencode.json:
"model": "ollama/qwen3:30b"

# Or switch at runtime with ctrl+m inside the TUI
```

---

## Verify It Works

```sh
# Quick smoke test — should return a response in <5s for a small model
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3:8b",
    "messages": [{"role": "user", "content": "Say hello in one word."}],
    "stream": false
  }' | python3 -m json.tool
```

---

## Useful Commands

```sh
ollama list                    # installed models
ollama ps                      # currently loaded model (and VRAM usage)
ollama rm <model>              # remove a model
ollama show <model>            # model metadata, context length, parameters
ollama run <model>             # interactive chat (good for quick tests)
ollama run <model> --verbose   # shows TG t/s and other perf stats after response
```

The `--verbose` flag on `ollama run` is useful for ballpark t/s estimates before running the full benchmark.
