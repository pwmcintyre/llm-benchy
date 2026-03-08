#!/usr/bin/env bash
set -euo pipefail

URL="${URL:-http://localhost:8000/v1/chat/completions}"
MODEL="${MODEL:-qwen-local}"

curl -sS "$URL" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"${MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"Write one sentence about why low latency matters for local LLM serving.\"}],\"temperature\":0.2,\"max_tokens\":80}" \
  | sed 's/\\n/ /g'

echo
