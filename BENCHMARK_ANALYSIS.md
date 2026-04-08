# Benchmark Analysis: Linux/WSL2 vs M1 Pro

## Models Tested (This Run)

| Model | Size | Parameter Class | Notes |
|---|---|---|---|
| **Qwen3.5 9B** | 6.6 GB | 9.7B | Edge model; smaller than benchmark baseline |
| **Gemma 4 E4B** | 9.6 GB | 8.0B | Edge model; smaller than benchmark baseline |

> **Note:** These are edge models (E4B, not the 26B or 31B variants in the original benchmark). They should be faster and lower quality than the documented baseline models.

---

## Documented Baselines (M1 Pro, April 2026)

### Speed (Ollama on M1 Pro)
| Model | TG t/s | TTFT (ms) | Size |
|---|---|---|---|
| **Qwen3 30B** | 40.8 | 1,176 | 18 GB |
| **Gemma 4 26B MoE** | 27.7 | 31,774 | 18 GB |
| **Gemma 4 31B** | 4.9 | 84,822 | 20 GB |
| **Phi-4 14B** | 13.2 | 1,798 | 9.1 GB |

### Quality (Claude Sonnet 4.6 judge, 0–10 scale)
| Model | Avg Score | Best category | Worst category |
|---|---|---|---|
| **Gemma 4 31B** | 9.3 | Code explanation (9.3) | Knowledge (2.8) |
| **Gemma 4 26B MoE** | 8.0 | Context retrieval (10), Code debug (9) | Knowledge (3.2) |
| **Phi-4 14B** | 6.8 | Code explain (8.3), Instruction follow (10) | Knowledge (2.5) |
| **Qwen3 30B** | 5.6 | Code explain (7.5) | Instruction follow (0) |

---

## Expected Results for This Run

### Hardware Differences
- **M1 Pro:** Unified memory, Metal GPU, ARM-based
- **WSL2/Linux:** Standard x86-64, system RAM, no Metal acceleration
- **Expected impact:** Different absolute numbers, but rankings should be similar

### Model Size Factors
- **Qwen3.5 9B vs Qwen3 30B:** ~3.3× smaller → expect 2–4× faster, lower quality
- **Gemma4 E4B vs Gemma4 26B MoE:** ~3.25× smaller → expect 2–4× faster, lower quality

### Hypothesis
- **Qwen3.5 9B:** 15–25 t/s, 1–3s TTFT (3× faster than Qwen3 30B baseline)
- **Gemma4 E4B:** 20–30 t/s, <2s TTFT (faster than Gemma4 26B baseline, similar to Phi-4)
- Quality: Both should score 6–8 (decent but below the larger variants)

---

## Comparison Questions

Once results arrive, we'll assess:

1. **Speed ranking:** Do smaller models maintain relative performance advantage?
2. **TTFT stability:** Is first-token latency predictable across hardware?
3. **Quality vs size:** Do the 9B/8B models deliver acceptable quality for interactive use?
4. **Practical viability:** Which model is best for interactive local use on this system?
5. **Hardware scaling:** How much did WSL2/x86-64 cost in absolute performance vs M1 Pro?

---

## Prompts Tested (First 5 categories)

1. **code-explain** — Technical explanation task
2. **code-write** — Code generation (open-ended)
3. **code-debug** — Bug identification and fix
4. **repo-summarise** — Long-context retrieval
5. **knowledge-local** — Open knowledge question

---

## Analysis Method

Once results arrive:
1. Parse JSONL results file
2. Calculate median/mean metrics per model
3. Compare to M1 Pro baselines
4. Identify best model for interactive use
5. Recommend local-model wiring strategy for OpenCode
