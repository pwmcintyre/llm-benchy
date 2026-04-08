# apfel Setup

Setup guide for using Apple's built-in Foundation Model via
[apfel](https://github.com/Arthur-Ficial/apfel) on Apple Silicon, with OpenCode integration.

---

## Prerequisites

| Requirement | How to check |
|---|---|
| macOS 26 (Tahoe) or newer | `sw_vers` — look for `ProductVersion: 26.x` |
| Apple Silicon (M1 or later) | `uname -m` — should return `arm64` |
| Apple Intelligence enabled | System Settings → Apple Intelligence & Siri → toggle on |

> Apple Intelligence must be enabled to download and activate the on-device model. You don't need
> to use Siri — just enabling the setting is enough. The model download is ~few GB and happens
> in the background.

---

## Install

```sh
brew install Arthur-Ficial/tap/apfel
```

Verify:

```sh
apfel --version
# v0.9.0 (or newer)

apfel "Hello"
# Should return a short response from the on-device model
```

---

## Start the Server

apfel exposes an OpenAI-compatible HTTP server. Use port `11435` to avoid conflicting with
Ollama which defaults to `11434`.

```sh
# Start server on port 11435 (avoids Ollama conflict)
apfel --serve --port 11435
# Server running on http://127.0.0.1:11435
```

> **Note:** apfel has no persistent background service — you need to start it manually each
> session, or add a launchd plist if you want it always available.

Verify the server is up:

```sh
curl http://localhost:11435/v1/models | python3 -m json.tool
# Should return: { "data": [{ "id": "apple-foundationmodel", ... }] }
```

Smoke test:

```sh
curl http://localhost:11435/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "apple-foundationmodel",
    "messages": [{"role": "user", "content": "Say hello in one word."}],
    "stream": false
  }' | python3 -m json.tool
```

---

## Context Window — Hard Limit

The `FoundationModels.framework` has a **4096 token context window (combined input + output)**.
This is an Apple framework limit — not configurable by apfel or any other tool.

**~3000 words in, ~800 words out** is a rough practical budget.

apfel implements five context-trimming strategies for the interactive chat mode, but the server
endpoint (`/v1/chat/completions`) respects the raw limit. Design prompts to stay well under budget:

| Task | Typical token use | Fits? |
|---|---|---|
| Grammar fix (~80 words) | ~120 tokens in, ~120 out | Yes |
| Commit message from diff --stat | ~200 tokens in, ~80 out | Yes |
| Explain a 10-line function | ~150 tokens in, ~250 out | Yes |
| Strict JSON single-turn | ~80 tokens in, ~50 out | Yes |
| Rename suggestions | ~100 tokens in, ~80 out | Yes |
| Explain a 100-line file | ~600 tokens in, ~400 out | Marginal |
| Multi-step agent loop | Accumulates → overflows | No |
| Whole-file review | Often > 4096 alone | No |

---

## OpenCode Provider Config

See [`../opencode/apfel-provider.json`](../opencode/apfel-provider.json) for the ready-to-paste
provider block. Minimal example:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "apfel": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "apfel (Apple Neural Engine)",
      "options": {
        "baseURL": "http://localhost:11435/v1",
        "apiKey": "unused"
      },
      "models": {
        "apple-foundationmodel": {
          "name": "Apple Foundation Model (on-device, Neural Engine)",
          "limit": { "context": 4096, "output": 2048 }
        }
      }
    }
  }
}
```

Select it in OpenCode via the model picker (`ctrl+m`). Use it for short, bounded tasks only —
grammar, commit messages, snippet explanations, JSON output, rename suggestions.

---

## Benchmark

apfel is benchmarked separately with a purpose-built prompt suite (category: `apfel` in
`benchmark/prompts.json`). These prompts are designed to stay well within the 4096-token limit.

```sh
# Run apfel-only prompts (requires apfel server running on port 11435)
node benchmark/run.mjs --model apple-foundationmodel --endpoint http://localhost:11435/v1 --category apfel

# No judge — fast offline run
node benchmark/run.mjs --model apple-foundationmodel --endpoint http://localhost:11435/v1 --category apfel --no-judge
```

---

## Limitations

| Limitation | Detail |
|---|---|
| Context window | 4096 tokens total — hard limit, not configurable |
| Model | Single fixed model — not swappable |
| No embeddings | `POST /v1/embeddings` returns 501 |
| No multi-modal | Images return 400 |
| No completion endpoint | `POST /v1/completions` (legacy) returns 501 |
| Apple guardrails | Safety filter may false-positive on security/system-level code |
| Port conflict | Default port 11434 clashes with Ollama — use `--port 11435` |
| macOS 26 only | Does not work on Sequoia or earlier |

---

## Useful Commands

```sh
apfel "Your prompt here"                    # single-shot CLI
apfel --chat                                # interactive multi-turn
apfel --serve --port 11435                  # OpenAI-compatible server
apfel --serve --port 11435 --token mysecret # with bearer token auth
apfel --update                              # check for + install updates
```
