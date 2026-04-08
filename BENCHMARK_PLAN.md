# Benchmark Run Plan (Linux/WSL2)

## Setup Requirements

1. **Ollama on Windows host** — Start it with:
   ```bash
   ollama serve
   ```
   This will listen on `localhost:11434`

2. **From WSL2, test connectivity:**
   ```bash
   curl -s http://localhost:11434/api/tags | jq .
   ```
   If Ollama is behind a Windows firewall, you may need to use the host IP instead:
   ```bash
   # Get host IP from WSL2
   cat /etc/resolv.conf | grep nameserver | awk '{print $2}'
   ```

## Benchmark Runs

Once Ollama is running, we'll test:

### 1. Quick validation (Phi-4 14B, 1 run, no judge)
```bash
cd ~/git/llm-benchy/benchmark
node run.mjs --model phi4:14b-q4_K_M --runs 1 --no-judge --engine ollama
```
Expected: ~2–3 minutes, baseline TTFT/TG speed

### 2. Full benchmark suite (Ollama models only, skip MLX)
```bash
node run.mjs --engine ollama --no-judge --runs 3
```
This runs all Ollama models with 3 iterations each. Results go to `results_<timestamp>.jsonl`

### 3. Compare to findings.md
- Findings are from M1 Pro (32 GB, unified memory, Metal acceleration)
- Linux/WSL2 will have different baselines (different CPU/GPU/RAM architecture)
- But ranking and relative quality scores should be comparable

## Known WSL2 Gotchas
- Ollama must be running on Windows **before** benchmark starts
- If `localhost:11434` doesn't respond, you may need `--endpoint http://<host-ip>:11434/v1`
- WSL2 network sometimes requires `host.docker.internal` instead of `localhost`

