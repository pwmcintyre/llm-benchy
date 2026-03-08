# Qwen on vLLM (Docker, WSL2 + NVIDIA)

## Quick start

1. Copy env file:

```bash
cd /home/pwm/qwen-vllm-docker
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

## Notes

- Default model is `Qwen/Qwen2.5-3B-Instruct` for reliable fit on 12GB VRAM.
- For better quality, try a quantized larger checkpoint and set `MODEL_NAME` + `QUANTIZATION` in `.env`.
- API endpoint is OpenAI-compatible at `http://localhost:8000/v1`.

## Evaluation Log

Ongoing setup and model-evaluation notes are tracked in [`FINDINGS.md`](./FINDINGS.md).
