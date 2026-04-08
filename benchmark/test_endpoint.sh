#!/bin/bash
# Quick test of endpoint connectivity

endpoint="${1:-http://localhost:11434/v1}"
echo "Testing endpoint: $endpoint"

# Test basic connectivity
response=$(curl -s -X POST "$endpoint/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "phi4:14b-q4_K_M",
    "messages": [{"role": "user", "content": "say hi"}],
    "stream": false,
    "max_tokens": 10
  }' 2>&1)

if echo "$response" | grep -q "error"; then
  echo "❌ Error: $response"
  exit 1
elif echo "$response" | grep -q "choices"; then
  echo "✓ Endpoint working"
  echo "$response" | head -c 200
  exit 0
else
  echo "⚠ Unexpected response: $response"
  exit 1
fi
