# Qwen on vLLM (Docker, WSL2 + NVIDIA)

## Quick start

1. Copy env file:

```bash
cd /home/pwm/git/qwen-vllm-docker
cp .env.example .env
```

2. Start server:

```bash
docker compose up -d
```

3. Watch logs until model is loaded:

```bash
docker logs -f qwen-vllm
```

4. Run smoke test:

```bash
./run-smoke-test.sh
```

## Quick Queries

Run a one-off query:

```bash
./query.sh "Give me 5 dinner ideas with high protein."
```

Optional model override:

```bash
./query.sh "Summarize this repo in 3 bullets." qwen-local
```

Optional tuning via env vars:

```bash
TEMP=0.7 MAX_TOKENS=500 ./query.sh "Write a short blog intro."
```

## Notes

- Default model is `Qwen/Qwen2.5-3B-Instruct` for reliable fit on 12GB VRAM.
- For better quality, try a quantized larger checkpoint and set `MODEL_NAME` + `QUANTIZATION` in `.env`.
- API endpoint is OpenAI-compatible at `http://localhost:8000/v1`.

## Evaluation Log

Ongoing setup and model-evaluation notes are tracked in [`FINDINGS.md`](./FINDINGS.md).

## OpenCode Setup (Local vLLM)

This repo includes a ready template at:

- `opencode/config.example.json`
- `opencode/env.example`

Typical flow:

```bash
cd /home/pwm/git/qwen-vllm-docker
docker compose up -d
```

Then point OpenCode at your local OpenAI-compatible endpoint:

- Base URL: `http://localhost:8000/v1`
- API key: `dummy` (or any placeholder)
- Model: `qwen-local`

If OpenCode supports env-based config, you can export:

```bash
export OPENAI_BASE_URL=http://localhost:8000/v1
export OPENAI_API_KEY=dummy
export OPENAI_MODEL=qwen-local
```
